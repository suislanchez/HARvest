import { Logger } from '@nestjs/common';
import type { LlmProvider } from './llm-provider.interface';
import { LlmMatchResult } from '../openai/openai.service';

/**
 * Tries LLM providers in order, falling back to the next on error.
 * Tracks which provider actually succeeded for response metadata.
 */
export class FallbackLlmProvider implements LlmProvider {
  private readonly logger = new Logger(FallbackLlmProvider.name);
  private _lastUsedProvider: string | undefined;
  private _lastUsedModel: string | undefined;

  get providerName(): string | undefined {
    return this._lastUsedProvider;
  }

  get modelName(): string | undefined {
    return this._lastUsedModel;
  }

  constructor(private readonly providers: LlmProvider[]) {
    if (providers.length === 0) {
      throw new Error('FallbackLlmProvider requires at least one provider');
    }
  }

  async identifyApiRequest(
    summary: string,
    userDescription: string,
    totalEntries: number,
    signal?: AbortSignal,
  ): Promise<LlmMatchResult> {
    let lastError: unknown;

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      const name = provider.providerName || `provider-${i}`;

      try {
        this.logger.log(`Trying provider: ${name}`);
        const result = await provider.identifyApiRequest(
          summary,
          userDescription,
          totalEntries,
          signal,
        );

        this._lastUsedProvider = provider.providerName;
        this._lastUsedModel = provider.modelName;
        return result;
      } catch (err) {
        lastError = err;
        const errMsg = err instanceof Error ? err.message : String(err);

        if (i < this.providers.length - 1) {
          this.logger.warn(
            `Provider ${name} failed: ${errMsg}. Falling back to next provider...`,
          );
        } else {
          this.logger.error(`All providers exhausted. Last error from ${name}: ${errMsg}`);
        }
      }
    }

    throw lastError;
  }
}
