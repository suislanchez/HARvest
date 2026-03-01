import { Module } from '@nestjs/common';
import { LocalLlmService } from './local-llm.service';

@Module({
  providers: [LocalLlmService],
  exports: [LocalLlmService],
})
export class LocalLlmModule {}
