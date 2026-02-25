import { HarParserService } from './har-parser.service';
import type { Entry } from 'har-format';

describe('Performance / Stress tests', () => {
  let service: HarParserService;

  beforeEach(() => {
    service = new HarParserService();
  });

  function makeEntry(index: number): Entry {
    return {
      startedDateTime: '2024-01-01T00:00:00.000Z',
      time: 100,
      request: {
        method: index % 3 === 0 ? 'POST' : 'GET',
        url: `https://api.example.com/resource/${index}?page=${index % 10}`,
        httpVersion: 'HTTP/2.0',
        cookies: [],
        headers: [
          { name: 'Authorization', value: 'Bearer token123' },
          { name: 'Content-Type', value: 'application/json' },
        ],
        queryString: [],
        postData: index % 3 === 0
          ? { mimeType: 'application/json', text: `{"id":${index},"data":"test"}` } as any
          : undefined,
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: 200,
        statusText: 'OK',
        httpVersion: 'HTTP/2.0',
        cookies: [],
        headers: [{ name: 'Content-Type', value: 'application/json' }],
        content: {
          size: 500,
          mimeType: 'application/json',
          text: `{"result":${index}}`,
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: 500,
      },
      cache: {},
      timings: { send: 0, wait: 50, receive: 50 },
    } as Entry;
  }

  it('should filter 1000 entries through filterApiRequests under 200ms', () => {
    const entries = Array.from({ length: 1000 }, (_, i) => makeEntry(i));
    const start = performance.now();
    const result = service.filterApiRequests(entries);
    const elapsed = performance.now() - start;

    expect(result.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(200);
  });

  it('should generate LLM summary for 1000 entries under 500ms', () => {
    const entries = Array.from({ length: 1000 }, (_, i) => makeEntry(i));
    const start = performance.now();
    const { summary: result } = service.generateLlmSummary(entries, 1000);
    const elapsed = performance.now() - start;

    expect(result.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });

  it('should handle entry with 100KB response body — preview truncated, under 100ms', () => {
    const largeBody = '{"data":"' + 'x'.repeat(100 * 1024) + '"}';
    const entry = makeEntry(0);
    (entry.response.content as any).text = largeBody;
    (entry.response.content as any).size = largeBody.length;

    const start = performance.now();
    const { summary: result } = service.generateLlmSummary([entry], 1);
    const elapsed = performance.now() - start;

    expect(result).not.toContain('x'.repeat(200));
    expect(elapsed).toBeLessThan(100);
  });

  it('should parse HAR with 2000 entries under 500ms', () => {
    const entries = Array.from({ length: 2000 }, (_, i) => ({
      startedDateTime: '2024-01-01T00:00:00.000Z',
      time: 100,
      request: {
        method: 'GET',
        url: `https://api.example.com/item/${i}`,
        httpVersion: 'HTTP/2.0',
        cookies: [],
        headers: [],
        queryString: [],
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: 200,
        statusText: 'OK',
        httpVersion: 'HTTP/2.0',
        cookies: [],
        headers: [],
        content: { size: 0, mimeType: 'application/json' },
        redirectURL: '',
        headersSize: -1,
        bodySize: 0,
      },
      cache: {},
      timings: { send: 0, wait: 50, receive: 50 },
    }));
    const har = { log: { version: '1.2', creator: { name: 'test', version: '1.0' }, entries } };
    const buffer = Buffer.from(JSON.stringify(har));

    const start = performance.now();
    const result = service.parseHar(buffer);
    const elapsed = performance.now() - start;

    expect(result.log.entries).toHaveLength(2000);
    expect(elapsed).toBeLessThan(500);
  });
});
