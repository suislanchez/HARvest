import { LlmMatchResult } from '../openai/openai.service';

/**
 * Common interface for all LLM providers (OpenAI, Groq, Local/Ollama).
 * Any service that implements this can be injected into AnalysisService.
 */
export interface LlmProvider {
  readonly providerName?: string;
  readonly modelName?: string;
  identifyApiRequest(
    summary: string,
    userDescription: string,
    totalEntries: number,
  ): Promise<LlmMatchResult>;
}

/**
 * Injection token for the active LLM provider.
 */
export const LLM_PROVIDER = 'LLM_PROVIDER';
