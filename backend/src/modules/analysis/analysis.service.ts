import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Entry } from 'har-format';
import { HarParserService, HarSummary } from './har-parser.service';
import { HarToCurlService } from './har-to-curl.service';
import { WsCommandService } from './ws-command.service';
import { LlmMatchResult } from '../openai/openai.service';
import { LLM_PROVIDER } from '../llm/llm-provider.interface';
import type { LlmProvider } from '../llm/llm-provider.interface';

export interface AnalysisResult {
  curl: string;
  type: 'http' | 'websocket' | 'sse';
  provider?: string;
  model?: string;
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
    curl: string;
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
    private readonly wsCommand: WsCommandService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
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

    // Step 5: Get the matched entry and generate curl/wscat
    const matchedEntry = filtered[llmResult.matchIndex];

    // Detect entry type
    const isWs = this.wsCommand.isWebSocketEntry(matchedEntry);
    const isSse = !isWs && this.wsCommand.isSSEEntry(matchedEntry);
    const entryType: 'http' | 'websocket' | 'sse' = isWs ? 'websocket' : isSse ? 'sse' : 'http';

    let curl: string;
    if (isWs) {
      const cmds = this.wsCommand.generateWsCommands(matchedEntry);
      curl = cmds.wscat;
    } else if (isSse) {
      curl = this.wsCommand.generateSseCurl(matchedEntry);
    } else {
      curl = this.harToCurl.generateCurl(matchedEntry);
    }

    const totalEnd = performance.now();

    // Build top matches with request info and pre-generated curl
    const topMatchesWithInfo = llmResult.topMatches.map((m) => {
      const entry = filtered[m.index];
      let matchCurl = '';
      if (entry) {
        if (this.wsCommand.isWebSocketEntry(entry)) {
          matchCurl = this.wsCommand.generateWsCommands(entry).wscat;
        } else if (this.wsCommand.isSSEEntry(entry)) {
          matchCurl = this.wsCommand.generateSseCurl(entry);
        } else {
          matchCurl = this.harToCurl.generateCurl(entry);
        }
      }
      return {
        index: m.index,
        confidence: m.confidence,
        reason: m.reason,
        method: entry?.request.method || 'UNKNOWN',
        url: entry?.request.url || 'UNKNOWN',
        curl: matchCurl,
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

    // Compute cost estimate (Groq pricing as default; $0 for local models)
    const cost =
      (llmResult.promptTokens * 0.59) / 1_000_000 +
      (llmResult.completionTokens * 0.79) / 1_000_000;

    return {
      curl,
      type: entryType,
      provider: this.llm.providerName,
      model: this.llm.modelName,
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
