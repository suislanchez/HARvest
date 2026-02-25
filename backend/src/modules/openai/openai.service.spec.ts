import { ConfigService } from '@nestjs/config';
import { OpenaiService } from './openai.service';

// Mock the OpenAI SDK
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }));
});

describe('OpenaiService', () => {
  let service: OpenaiService;
  let mockCreate: jest.Mock;

  beforeEach(() => {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'test-key';
        if (key === 'OPENAI_MODEL') return 'gpt-4o-mini';
        return undefined;
      }),
    } as unknown as ConfigService;

    service = new OpenaiService(configService);
    // Access the mocked create method
    mockCreate = (service as any).client.chat.completions.create;
  });

  it('should parse a well-formed topMatches response', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              topMatches: [
                { index: 2, confidence: 0.95, reason: 'Best match' },
                { index: 5, confidence: 0.6, reason: 'Possible match' },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const result = await service.identifyApiRequest('summary', 'find users', 10);

    expect(result.matchIndex).toBe(2);
    expect(result.confidence).toBe(0.95);
    expect(result.reason).toBe('Best match');
    expect(result.topMatches).toHaveLength(2);
    expect(result.topMatches[1].index).toBe(5);
  });

  it('should handle a flat response (no topMatches array)', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              index: 3,
              confidence: 0.88,
              reason: 'Direct match',
            }),
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 30 },
    });

    const result = await service.identifyApiRequest('summary', 'find users', 10);

    expect(result.matchIndex).toBe(3);
    expect(result.confidence).toBe(0.88);
  });

  it('should throw on empty LLM response', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
      usage: { prompt_tokens: 100, completion_tokens: 0 },
    });

    await expect(
      service.identifyApiRequest('summary', 'find users', 10),
    ).rejects.toThrow('Empty response from LLM');
  });

  it('should throw when LLM returns invalid JSON', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'not valid json' } }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    });

    await expect(
      service.identifyApiRequest('summary', 'find users', 10),
    ).rejects.toThrow();
  });

  it('should filter out-of-range indices', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              topMatches: [
                { index: 999, confidence: 0.9, reason: 'Out of range' },
                { index: -1, confidence: 0.8, reason: 'Negative' },
                { index: 2, confidence: 0.7, reason: 'Valid' },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const result = await service.identifyApiRequest('summary', 'find users', 5);

    // Only index 2 is valid (0-4 range)
    expect(result.matchIndex).toBe(2);
    expect(result.topMatches).toHaveLength(1);
  });

  it('should throw when ALL indices are out of range', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              topMatches: [
                { index: 999, confidence: 0.9, reason: 'Out of range' },
                { index: -1, confidence: 0.8, reason: 'Negative' },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 30 },
    });

    await expect(
      service.identifyApiRequest('summary', 'find users', 5),
    ).rejects.toThrow('no valid match indices');
  });

  it('should handle missing confidence and reason gracefully', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              topMatches: [{ index: 0 }],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });

    const result = await service.identifyApiRequest('summary', 'find users', 5);

    expect(result.matchIndex).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.reason).toBe('');
  });

  it('should coerce string index/confidence to numbers', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              topMatches: [
                { index: '3', confidence: '0.85', reason: 'Coerced' },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });

    const result = await service.identifyApiRequest('summary', 'find users', 10);

    expect(result.matchIndex).toBe(3);
    expect(result.confidence).toBe(0.85);
  });

  it('should throw if OPENAI_API_KEY is not configured', () => {
    const emptyConfig = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;

    expect(() => new OpenaiService(emptyConfig)).toThrow('OPENAI_API_KEY is not configured');
  });

  it('should default to gpt-4o-mini when OPENAI_MODEL is not set', () => {
    const configNoModel = {
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'test-key';
        return undefined;
      }),
    } as unknown as ConfigService;

    const svc = new OpenaiService(configNoModel);
    expect((svc as any).model).toBe('gpt-4o-mini');
  });

  it('should handle partial match with only 1 result', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              topMatches: [
                { index: 1, confidence: 0.75, reason: 'Only match' },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 80, completion_tokens: 20 },
    });

    const result = await service.identifyApiRequest('summary', 'find data', 5);
    expect(result.topMatches).toHaveLength(1);
    expect(result.matchIndex).toBe(1);
  });

  it('should keep duplicate indices — first wins for matchIndex', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              topMatches: [
                { index: 2, confidence: 0.9, reason: 'First occurrence' },
                { index: 2, confidence: 0.5, reason: 'Duplicate' },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 80, completion_tokens: 30 },
    });

    const result = await service.identifyApiRequest('summary', 'find data', 5);
    expect(result.matchIndex).toBe(2);
    expect(result.topMatches).toHaveLength(2);
  });

  it('should coerce NaN confidence to 0', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              topMatches: [
                { index: 0, confidence: 'not-a-number', reason: 'Test' },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 80, completion_tokens: 20 },
    });

    const result = await service.identifyApiRequest('summary', 'find data', 5);
    expect(result.confidence).toBe(0);
  });

  it('should propagate API call failure (rate limit)', async () => {
    mockCreate.mockRejectedValue(new Error('Rate limit exceeded'));

    await expect(
      service.identifyApiRequest('summary', 'find data', 5),
    ).rejects.toThrow('Rate limit exceeded');
  });

  it('should propagate network error (ECONNREFUSED)', async () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:443');
    (err as any).code = 'ECONNREFUSED';
    mockCreate.mockRejectedValue(err);

    await expect(
      service.identifyApiRequest('summary', 'find data', 5),
    ).rejects.toThrow('ECONNREFUSED');
  });
});
