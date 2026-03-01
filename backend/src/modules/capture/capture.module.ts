import { Module } from '@nestjs/common';
import { CaptureController } from './capture.controller';
import { CaptureService } from './capture.service';

@Module({
  controllers: [CaptureController],
  providers: [CaptureService],
})
export class CaptureModule {}
