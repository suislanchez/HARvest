import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { LlmMatchResult } from '../openai/openai.service';

/**
 * Local LLM provider via Ollama (OpenAI-compatible API on localhost).
 *
 * Zero API calls, zero cost, runs entirely on your machine.
 * Works with any Ollama model: llama3.2:1b, llama3.2:3b, qwen2.5:3b, phi4-mini, etc.
 *
 * Configure via env vars:
 *   LOCAL_LLM_MODEL=llama3.2:3b        (default)
 *   LOCAL_LLM_BASE_URL=http://localhost:11434/v1  (default)
 */
@Injectable()
export class LocalLlmService {
  private readonly client: OpenAI;
  private readonly logger = new Logger(LocalLlmService.name);
  readonly model: string;

  get providerName(): string { return 'local'; }
  get modelName(): string { return this.model; }

  constructor(private configService: ConfigService) {
    const baseURL = this.configService.get<string>('LOCAL_LLM_BASE_URL') || 'http://localhost:11434/v1';
    this.model = this.configService.get<string>('LOCAL_LLM_MODEL') || 'llama3.2:3b';

    this.client = new OpenAI({
      apiKey: 'ollama', // Ollama doesn't need a real key
      baseURL,
    });
  }

  async identifyApiRequest(
    summary: string,
    userDescription: string,
    totalEntries: number,
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

You MUST respond with valid JSON only, no other text:
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
      `Sending grouped summary (${totalEntries} entries) to local/${this.model} for matching`,
    );

    const start = Date.now();

    // Try with json format first, fall back to plain if model doesn't support it
    let content: string | null = null;
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });
      content = response.choices[0]?.message?.content;
    } catch {
      // Some models don't support json_object format, retry without it
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
      });
      content = response.choices[0]?.message?.content;
    }

    const elapsed = Date.now() - start;

    if (!content) {
      throw new Error('Empty response from local LLM');
    }

    this.logger.log(`Local LLM responded in ${elapsed}ms`);

    // Extract JSON from response (local models sometimes wrap it in markdown)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    // Also try to find raw JSON object
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      jsonStr = braceMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    const topMatches = (parsed.topMatches || [parsed]).map((match: any) => ({
      index: Number(match.index),
      confidence: Number(match.confidence) || 0,
      reason: String(match.reason || ''),
    }));

    const validMatches = topMatches.filter(
      (m: any) => m.index >= 0 && m.index < totalEntries,
    );

    if (validMatches.length === 0) {
      throw new Error(`Local LLM (${this.model}) returned no valid match indices. Raw: ${content.substring(0, 200)}`);
    }

    return {
      matchIndex: validMatches[0].index,
      confidence: validMatches[0].confidence,
      reason: validMatches[0].reason,
      topMatches: validMatches,
      promptTokens: Math.round(summary.length / 4), // estimate
      completionTokens: Math.round(content.length / 4),
    };
  }
}
