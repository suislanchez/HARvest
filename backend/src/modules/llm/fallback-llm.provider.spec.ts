import { FallbackLlmProvider } from './fallback-llm.provider';
import type { LlmProvider } from './llm-provider.interface';
import { LlmMatchResult } from '../openai/openai.service';

function makeMockProvider(
  name: string,
  result?: LlmMatchResult,
  error?: Error,
): LlmProvider {
  return {
    providerName: name,
    modelName: `${name}-model`,
    identifyApiRequest: jest.fn().mockImplementation(() => {
      if (error) return Promise.reject(error);
      return Promise.resolve(
        result ?? {
          matchIndex: 0,
          confidence: 0.9,
          reason: `matched by ${name}`,
          topMatches: [{ index: 0, confidence: 0.9, reason: `matched by ${name}` }],
          promptTokens: 100,
          completionTokens: 50,
        },
      );
    }),
  };
}

describe('FallbackLlmProvider', () => {
  it('should use the first provider when it succeeds', async () => {
    const p1 = makeMockProvider('primary');
    const p2 = makeMockProvider('secondary');
    const fallback = new FallbackLlmProvider([p1, p2]);

    const result = await fallback.identifyApiRequest('summary', 'desc', 10);

    expect(result.reason).toBe('matched by primary');
    expect(p1.identifyApiRequest).toHaveBeenCalledTimes(1);
    expect(p2.identifyApiRequest).not.toHaveBeenCalled();
    expect(fallback.providerName).toBe('primary');
    expect(fallback.modelName).toBe('primary-model');
  });

  it('should fall back to second provider on first failure', async () => {
    const p1 = makeMockProvider('primary', undefined, new Error('API key invalid'));
    const p2 = makeMockProvider('secondary');
    const fallback = new FallbackLlmProvider([p1, p2]);

    const result = await fallback.identifyApiRequest('summary', 'desc', 10);

    expect(result.reason).toBe('matched by secondary');
    expect(p1.identifyApiRequest).toHaveBeenCalledTimes(1);
    expect(p2.identifyApiRequest).toHaveBeenCalledTimes(1);
    expect(fallback.providerName).toBe('secondary');
  });

  it('should fall back through multiple providers', async () => {
    const p1 = makeMockProvider('first', undefined, new Error('down'));
    const p2 = makeMockProvider('second', undefined, new Error('also down'));
    const p3 = makeMockProvider('third');
    const fallback = new FallbackLlmProvider([p1, p2, p3]);

    const result = await fallback.identifyApiRequest('summary', 'desc', 10);

    expect(result.reason).toBe('matched by third');
    expect(fallback.providerName).toBe('third');
  });

  it('should throw when all providers fail', async () => {
    const p1 = makeMockProvider('first', undefined, new Error('error 1'));
    const p2 = makeMockProvider('second', undefined, new Error('error 2'));
    const fallback = new FallbackLlmProvider([p1, p2]);

    await expect(
      fallback.identifyApiRequest('summary', 'desc', 10),
    ).rejects.toThrow('error 2');
  });

  it('should throw if constructed with zero providers', () => {
    expect(() => new FallbackLlmProvider([])).toThrow(
      'FallbackLlmProvider requires at least one provider',
    );
  });

  it('should pass signal to providers', async () => {
    const p1 = makeMockProvider('primary');
    const fallback = new FallbackLlmProvider([p1]);
    const controller = new AbortController();

    await fallback.identifyApiRequest('summary', 'desc', 10, controller.signal);

    expect(p1.identifyApiRequest).toHaveBeenCalledWith(
      'summary',
      'desc',
      10,
      controller.signal,
    );
  });

  it('should work with a single provider', async () => {
    const p1 = makeMockProvider('solo');
    const fallback = new FallbackLlmProvider([p1]);

    const result = await fallback.identifyApiRequest('summary', 'desc', 10);
    expect(result.reason).toBe('matched by solo');
    expect(fallback.providerName).toBe('solo');
  });
});
