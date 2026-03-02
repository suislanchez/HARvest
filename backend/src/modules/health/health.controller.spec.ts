import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('should return health status', () => {
    const result = controller.getHealth();

    expect(result.status).toBe('ok');
    expect(typeof result.uptime).toBe('number');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    expect(result.memory).toBeDefined();
    expect(typeof result.memory.rss).toBe('number');
    expect(typeof result.memory.heapUsed).toBe('number');
    expect(typeof result.memory.heapTotal).toBe('number');
  });

  it('should report increasing uptime', async () => {
    const first = controller.getHealth();
    await new Promise((r) => setTimeout(r, 50));
    const second = controller.getHealth();

    expect(second.uptime).toBeGreaterThanOrEqual(first.uptime);
  });

  it('should return valid ISO timestamp', () => {
    const result = controller.getHealth();
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
