import { Module } from '@nestjs/common';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { HarParserService } from './har-parser.service';
import { HarToCurlService } from './har-to-curl.service';
import { GroqModule } from '../groq/groq.module';

@Module({
  imports: [GroqModule],
  controllers: [AnalysisController],
  providers: [AnalysisService, HarParserService, HarToCurlService],
})
export class AnalysisModule {}
