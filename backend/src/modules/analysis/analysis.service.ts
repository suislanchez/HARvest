import { Injectable, Logger } from '@nestjs/common';
import type { Entry } from 'har-format';
import { HarParserService, HarSummary } from './har-parser.service';
import { HarToCurlService } from './har-to-curl.service';
import { OpenaiService, LlmMatchResult } from '../openai/openai.service';

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
    tokenEstimate: number;
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
    private readonly openai: OpenaiService,
  ) {}

  async analyzeHar(
    fileBuffer: Buffer,
    description: string,
  ): Promise<AnalysisResult> {
    // Step 1: Parse HAR
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
    const llmSummary = this.harParser.generateLlmSummary(filtered, allEntries.length);

    // Estimate tokens (~4 chars per token + ~200 for prompt)
    const tokenEstimate = llmSummary.length / 4 + 200;
    this.logger.log(`Estimated token usage: ~${Math.round(tokenEstimate)}`);

    // Step 4: LLM matching
    const llmResult: LlmMatchResult = await this.openai.identifyApiRequest(
      llmSummary,
      description,
      filtered.length,
    );

    // Step 5: Get the matched entry and generate curl
    const matchedEntry = filtered[llmResult.matchIndex];
    const curl = this.harToCurl.generateCurl(matchedEntry);

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
        tokenEstimate: Math.round(tokenEstimate),
      },
      allRequests,
    };
  }
}
