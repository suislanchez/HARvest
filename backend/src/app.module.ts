import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalysisModule } from './modules/analysis/analysis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
    AnalysisModule,
  ],
})
export class AppModule {}
