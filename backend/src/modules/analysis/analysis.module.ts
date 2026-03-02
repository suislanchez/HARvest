import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { HarParserService } from './har-parser.service';
import { HarToCurlService } from './har-to-curl.service';
import { WsCommandService } from './ws-command.service';
import { LLM_PROVIDER, LlmProvider } from '../llm/llm-provider.interface';
import { GroqService } from '../groq/groq.service';
import { OpenaiService } from '../openai/openai.service';
import { LocalLlmService } from '../local-llm/local-llm.service';
import { FallbackLlmProvider } from '../llm/fallback-llm.provider';

const logger = new Logger('AnalysisModule');

/**
 * Creates a single LLM provider by name.
 * Returns null if the provider cannot be initialised (e.g. missing API key).
 */
function createProvider(name: string, configService: ConfigService): LlmProvider | null {
  try {
    switch (name) {
      case 'local':
        return new LocalLlmService(configService);
      case 'openai':
        return new OpenaiService(configService);
      case 'groq':
        return new GroqService(configService);
      default:
        logger.warn(`Unknown provider "${name}", skipping`);
        return null;
    }
  } catch (err) {
    logger.warn(`Failed to create provider "${name}": ${(err as Error).message}`);
    return null;
  }
}

/**
 * Dynamically selects LLM provider based on LLM_PROVIDER env var.
 * If LLM_FALLBACK is set (e.g. "openai,local"), builds a fallback chain.
 */
@Module({
  imports: [ConfigModule],
  controllers: [AnalysisController],
  providers: [
    AnalysisService,
    HarParserService,
    HarToCurlService,
    WsCommandService,
    {
      provide: LLM_PROVIDER,
      useFactory: (configService: ConfigService): LlmProvider => {
        const fallbackEnv = configService.get<string>('LLM_FALLBACK');

        if (fallbackEnv) {
          // Build fallback chain from comma-separated list
          const names = fallbackEnv.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
          const providers = names
            .map((name) => createProvider(name, configService))
            .filter((p): p is LlmProvider => p !== null);

          if (providers.length === 0) {
            throw new Error(`LLM_FALLBACK="${fallbackEnv}" — no providers could be initialised`);
          }

          logger.log(`Fallback chain: ${providers.map((p) => p.providerName).join(' → ')}`);
          return new FallbackLlmProvider(providers);
        }

        // Single provider mode (current default behavior)
        const providerName = (configService.get<string>('LLM_PROVIDER') || 'groq').toLowerCase();
        const provider = createProvider(providerName, configService);
        if (!provider) {
          throw new Error(`Failed to create LLM provider "${providerName}"`);
        }
        return provider;
      },
      inject: [ConfigService],
    },
  ],
})
export class AnalysisModule {}
