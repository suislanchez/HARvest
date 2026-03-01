import { Body, Controller, Post, Res, ValidationPipe } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import * as express from 'express';
import { CaptureService } from './capture.service';
import { CaptureHarDto } from './dto/capture-har.dto';

@Controller('capture')
export class CaptureController {
  constructor(private readonly captureService: CaptureService) {}

  @Post()
  @SkipThrottle()
  async capture(
    @Body(new ValidationPipe({ whitelist: true })) dto: CaptureHarDto,
    @Res() res: express.Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // 30s hard timeout for the entire capture
    const timeout = setTimeout(() => {
      send('error', { message: 'Capture timed out after 30 seconds' });
      res.end();
    }, 30_000);

    try {
      const harContent = await this.captureService.captureHar(
        dto.url,
        (step, message) => send('progress', { step, message }),
      );

      send('complete', {
        har: harContent,
        filename: `auto-capture-${new URL(dto.url).hostname}.har`,
      });
    } catch (err) {
      send('error', { message: (err as Error).message });
    } finally {
      clearTimeout(timeout);
      res.end();
    }
  }
}
