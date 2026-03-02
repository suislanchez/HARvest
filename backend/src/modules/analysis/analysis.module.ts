import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { HarParserService } from './har-parser.service';
import { HarToCurlService } from './har-to-curl.service';
import { WsCommandService } from './ws-command.service';
import { LLM_PROVIDER } from '../llm/llm-provider.interface';
import { GroqService } from '../groq/groq.service';
import { OpenaiService } from '../openai/openai.service';
import { LocalLlmService } from '../local-llm/local-llm.service';

/**
 * Dynamically selects LLM provider based on LLM_PROVIDER env var:
 *   - "local"  → LocalLlmService (Ollama, zero cost)
 *   - "openai" → OpenaiService (GPT-4o-mini)
 *   - "groq"   → GroqService (Llama-3.3-70b via Groq, default)
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
      useFactory: (configService: ConfigService) => {
        const provider = (configService.get<string>('LLM_PROVIDER') || 'groq').toLowerCase();
        switch (provider) {
          case 'local':
            return new LocalLlmService(configService);
          case 'openai':
            return new OpenaiService(configService);
          case 'groq':
          default:
            return new GroqService(configService);
        }
      },
      inject: [ConfigService],
    },
  ],
})
export class AnalysisModule {}
