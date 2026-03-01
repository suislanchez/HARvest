import { Injectable, Logger } from '@nestjs/common';
import type { Entry } from 'har-format';
import { HarParserService, HarSummary } from './har-parser.service';
import { HarToCurlService } from './har-to-curl.service';
import { LlmMatchResult } from '../openai/openai.service';
import { GroqService } from '../groq/groq.service';

export interface AnalysisResult {
  curl: string;
  matchedRequest: {
    method: string;
    url: string;
    status: number;
    contentType: string;
  };
  confidence: number;
  reason: string;
  topMatches: Array<{
    index: number;
    confidence: number;
    reason: string;
    method: string;
    url: string;
  }>;
  stats: {
    totalRequests: number;
    filteredRequests: number;
    uniqueRequests: number;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    processingTime: {
      total: number;
      parsing: number;
      llm: number;
    };
  };
  allRequests: Array<{
    method: string;
    url: string;
    status: number;
    contentType: string;
    time: number;
  }>;
}

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly harParser: HarParserService,
    private readonly harToCurl: HarToCurlService,
    private readonly llm: GroqService,
  ) {}

  async analyzeHar(
    fileBuffer: Buffer,
    description: string,
  ): Promise<AnalysisResult> {
    const totalStart = performance.now();

    // Step 1: Parse HAR
    const parseStart = performance.now();
    const har = this.harParser.parseHar(fileBuffer);
    const allEntries = har.log.entries;
    this.logger.log(`Parsed HAR with ${allEntries.length} total entries`);

    // Step 2: Pre-filter
    const filtered = this.harParser.filterApiRequests(allEntries);
    this.logger.log(
      `Filtered to ${filtered.length} API candidates (from ${allEntries.length})`,
    );

    if (filtered.length === 0) {
      throw new Error(
        'No API requests found in HAR file after filtering. The file may only contain static assets.',
      );
    }

    // Step 3: Summarize for LLM
    const summaries = this.harParser.summarizeEntries(filtered);
    const { summary: llmSummary, uniqueCount } = this.harParser.generateLlmSummary(filtered, allEntries.length);
    const parseEnd = performance.now();

    this.logger.log(`Unique requests after dedup: ${uniqueCount}`);

    // Step 4: LLM matching
    const llmStart = performance.now();
    const llmResult: LlmMatchResult = await this.llm.identifyApiRequest(
      llmSummary,
      description,
      filtered.length,
    );
    const llmEnd = performance.now();

    // Step 5: Get the matched entry and generate curl
    const matchedEntry = filtered[llmResult.matchIndex];
    const curl = this.harToCurl.generateCurl(matchedEntry);

    const totalEnd = performance.now();

    // Build top matches with request info
    const topMatchesWithInfo = llmResult.topMatches.map((m) => {
      const entry = filtered[m.index];
      return {
        index: m.index,
        confidence: m.confidence,
        reason: m.reason,
        method: entry?.request.method || 'UNKNOWN',
        url: entry?.request.url || 'UNKNOWN',
      };
    });

    // Build all requests summary for inspector
    const allRequests = allEntries.map((entry) => ({
      method: entry.request.method,
      url: entry.request.url,
      status: entry.response.status,
      contentType: (entry.response.content?.mimeType || '').split(';')[0].trim(),
      time: entry.time || 0,
    }));

    // Compute cost: Groq Llama-3.3-70b pricing ($0.59/M input, $0.79/M output)
    const cost =
      (llmResult.promptTokens * 0.59) / 1_000_000 +
      (llmResult.completionTokens * 0.79) / 1_000_000;

    return {
      curl,
      matchedRequest: {
        method: matchedEntry.request.method,
        url: matchedEntry.request.url,
        status: matchedEntry.response.status,
        contentType: (matchedEntry.response.content?.mimeType || '').split(';')[0].trim(),
      },
      confidence: llmResult.confidence,
      reason: llmResult.reason,
      topMatches: topMatchesWithInfo,
      stats: {
        totalRequests: allEntries.length,
        filteredRequests: filtered.length,
        uniqueRequests: uniqueCount,
        promptTokens: llmResult.promptTokens,
        completionTokens: llmResult.completionTokens,
        cost: Math.round(cost * 1_000_000) / 1_000_000, // 6 decimal places
        processingTime: {
          total: Math.round(totalEnd - totalStart),
          parsing: Math.round(parseEnd - parseStart),
          llm: Math.round(llmEnd - llmStart),
        },
      },
      allRequests,
    };
  }
}
