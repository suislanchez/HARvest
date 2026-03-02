import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('health')
export class HealthController {
  private readonly startTime = Date.now();

  @Get()
  @SkipThrottle()
  getHealth() {
    return {
      status: 'ok',
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      },
    };
  }
}
