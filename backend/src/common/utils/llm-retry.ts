import { Logger } from '@nestjs/common';

export interface RetryOptions {
  /** Maximum number of retries (default: 2) */
  retries?: number;
  /** Per-attempt timeout in ms (default: 30_000) */
  timeoutMs?: number;
  /** Base backoff delay in ms, doubles each retry (default: 1000) */
  baseDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  retries: 2,
  timeoutMs: 30_000,
  baseDelayMs: 1_000,
};

/**
 * Check if an error is retryable (timeout, 429, 5xx).
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    // AbortError from our timeout
    if (err.name === 'AbortError') return true;
    // Timeout errors from various sources
    if (err.message.includes('timeout') || err.message.includes('Timeout')) return true;
  }

  // OpenAI SDK and HTTP errors with status codes
  const status = (err as any)?.status ?? (err as any)?.response?.status;
  if (typeof status === 'number') {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
  }

  // Connection errors
  if (err instanceof Error) {
    if (err.message.includes('ECONNREFUSED') || err.message.includes('ECONNRESET') || err.message.includes('fetch failed')) {
      return true;
    }
  }

  return false;
}

/**
 * Wraps an async function with per-attempt timeout and exponential backoff retry.
 *
 * @param fn - Function to execute. Receives an AbortSignal for the current attempt.
 * @param logger - NestJS logger instance for logging retries.
 * @param opts - Retry options.
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  logger: Logger,
  opts?: RetryOptions,
): Promise<T> {
  const { retries, timeoutMs, baseDelayMs } = { ...DEFAULT_OPTIONS, ...opts };

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await fn(controller.signal);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;

      if (attempt < retries && isRetryable(err)) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `LLM call failed (attempt ${attempt + 1}/${retries + 1}): ${errMsg}. Retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        break;
      }
    }
  }

  throw lastError;
}
