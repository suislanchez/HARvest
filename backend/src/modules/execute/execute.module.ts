import { Module } from '@nestjs/common';
import { ExecuteController } from './execute.controller';

@Module({
  controllers: [ExecuteController],
})
export class ExecuteModule {}
