import { Logger } from '@nestjs/common';
import { withRetry } from './llm-retry';

describe('withRetry', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('TestRetry');
    jest.spyOn(logger, 'warn').mockImplementation();
  });

  it('should return result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, logger, { retries: 2, timeoutMs: 5000 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should pass AbortSignal to fn', async () => {
    const fn = jest.fn().mockImplementation((signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve('ok');
    });
    await withRetry(fn, logger);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on timeout (AbortError)', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';

    const fn = jest
      .fn()
      .mockRejectedValueOnce(abortError)
      .mockResolvedValue('recovered');

    const result = await withRetry(fn, logger, { retries: 2, baseDelayMs: 10 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('should retry on 429 status', async () => {
    const rateLimitError = Object.assign(new Error('Rate limited'), { status: 429 });

    const fn = jest
      .fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValue('ok');

    const result = await withRetry(fn, logger, { retries: 2, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on 500 status', async () => {
    const serverError = Object.assign(new Error('Server error'), { status: 500 });

    const fn = jest
      .fn()
      .mockRejectedValueOnce(serverError)
      .mockResolvedValue('ok');

    const result = await withRetry(fn, logger, { retries: 2, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on ECONNREFUSED', async () => {
    const connError = new Error('connect ECONNREFUSED 127.0.0.1:11434');

    const fn = jest
      .fn()
      .mockRejectedValueOnce(connError)
      .mockResolvedValue('ok');

    const result = await withRetry(fn, logger, { retries: 2, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry on non-retryable errors (e.g. 400)', async () => {
    const badRequest = Object.assign(new Error('Bad request'), { status: 400 });

    const fn = jest.fn().mockRejectedValue(badRequest);

    await expect(withRetry(fn, logger, { retries: 2, baseDelayMs: 10 })).rejects.toThrow('Bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should throw after exhausting all retries', async () => {
    const serverError = Object.assign(new Error('Server error'), { status: 500 });

    const fn = jest.fn().mockRejectedValue(serverError);

    await expect(withRetry(fn, logger, { retries: 2, baseDelayMs: 10 })).rejects.toThrow('Server error');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('should use exponential backoff delays', async () => {
    const serverError = Object.assign(new Error('Server error'), { status: 500 });

    const fn = jest.fn().mockRejectedValue(serverError);
    const start = Date.now();

    await expect(withRetry(fn, logger, { retries: 2, baseDelayMs: 50 })).rejects.toThrow();

    const elapsed = Date.now() - start;
    // Should wait ~50ms + ~100ms = ~150ms total
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should timeout long-running calls', async () => {
    const fn = jest.fn().mockImplementation(
      (signal: AbortSignal) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve('late'), 10000);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    await expect(
      withRetry(fn, logger, { retries: 0, timeoutMs: 50 }),
    ).rejects.toThrow();
  }, 10000);

  it('should respect custom options', async () => {
    const fn = jest.fn().mockResolvedValue('ok');

    await withRetry(fn, logger, {
      retries: 5,
      timeoutMs: 60000,
      baseDelayMs: 2000,
    });

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
