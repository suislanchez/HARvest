import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { withRetry } from '../../common/utils/llm-retry';

export interface LlmMatchResult {
  matchIndex: number;
  confidence: number;
  reason: string;
  topMatches: Array<{ index: number; confidence: number; reason: string }>;
  promptTokens: number;
  completionTokens: number;
}

@Injectable()
export class OpenaiService {
  private readonly client: OpenAI;
  private readonly logger = new Logger(OpenaiService.name);
  private readonly model: string;

  get providerName(): string { return 'openai'; }
  get modelName(): string { return this.model; }

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    this.client = new OpenAI({ apiKey });
    this.model = this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';
  }

  async identifyApiRequest(
    summary: string,
    userDescription: string,
    totalEntries: number,
    signal?: AbortSignal,
  ): Promise<LlmMatchResult> {
    const systemPrompt = `You are an API reverse-engineering expert. You analyze HTTP request summaries from HAR files and identify which request best matches a user's description.

The summaries are grouped by hostname. Each entry has a global index number.
Format: "INDEX. METHOD /path → STATUS mime (size) [body:|preview: ...]"

Rules:
- Use the index number to identify requests
- Focus on URL paths, query params, request body, and response previews
- For GraphQL: look at operationName in the body
- Response previews help confirm the API's purpose
- Prefer application/json responses

Response format (JSON only):
{
  "topMatches": [
    {"index": <number>, "confidence": <0.0-1.0>, "reason": "<brief>"},
    ...up to 3
  ]
}`;

    const userPrompt = `User wants to find: "${userDescription}"

${summary}

Identify the best matching request(s). Return JSON only.`;

    this.logger.log(
      `Sending grouped summary (${totalEntries} entries) to ${this.model} for matching`,
    );

    const response = await withRetry(
      (retrySignal) =>
        this.client.chat.completions.create(
          {
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            max_tokens: 500,
            temperature: 0.1,
          },
          { signal: signal ?? retrySignal },
        ),
      this.logger,
      { timeoutMs: 30_000 },
    );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    this.logger.log(
      `Token usage: ${response.usage?.prompt_tokens} input, ${response.usage?.completion_tokens} output`,
    );

    const parsed = JSON.parse(content);

    // Validate the response structure
    const topMatches = (parsed.topMatches || [parsed]).map((match: any) => ({
      index: Number(match.index),
      confidence: Number(match.confidence) || 0,
      reason: String(match.reason || ''),
    }));

    // Validate indices are in range
    const validMatches = topMatches.filter(
      (m: any) => m.index >= 0 && m.index < totalEntries,
    );

    if (validMatches.length === 0) {
      throw new Error('LLM returned no valid match indices');
    }

    return {
      matchIndex: validMatches[0].index,
      confidence: validMatches[0].confidence,
      reason: validMatches[0].reason,
      topMatches: validMatches,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
    };
  }
}
