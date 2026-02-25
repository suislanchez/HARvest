import { HarToCurlService } from './har-to-curl.service';
import type { Entry } from 'har-format';

describe('HarToCurlService', () => {
  let service: HarToCurlService;

  beforeEach(() => {
    service = new HarToCurlService();
  });

  function makeEntry(
    overrides: Partial<{
      method: string;
      url: string;
      headers: Array<{ name: string; value: string }>;
      postData: { mimeType: string; text: string } | undefined;
      status: number;
    }> = {},
  ): Entry {
    return {
      startedDateTime: '2024-01-01T00:00:00.000Z',
      time: 100,
      request: {
        method: overrides.method ?? 'GET',
        url: overrides.url ?? 'https://api.example.com/data',
        httpVersion: 'HTTP/2.0',
        cookies: [],
        headers: overrides.headers ?? [],
        queryString: [],
        postData: overrides.postData as any,
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: overrides.status ?? 200,
        statusText: 'OK',
        httpVersion: 'HTTP/2.0',
        cookies: [],
        headers: [{ name: 'Content-Type', value: 'application/json' }],
        content: { size: 100, mimeType: 'application/json' },
        redirectURL: '',
        headersSize: -1,
        bodySize: 100,
      },
      cache: {},
      timings: { send: 0, wait: 50, receive: 50 },
    } as Entry;
  }

  describe('generateCurl', () => {
    it('should generate a basic GET request', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/weather?city=SF',
      });
      const curl = service.generateCurl(entry);
      expect(curl).toContain("'https://api.example.com/weather?city=SF'");
      expect(curl).not.toContain('-X');
      expect(curl).toContain('--compressed');
    });

    it('should generate a POST request with JSON body', () => {
      const entry = makeEntry({
        method: 'POST',
        url: 'https://api.example.com/search',
        headers: [{ name: 'Content-Type', value: 'application/json' }],
        postData: {
          mimeType: 'application/json',
          text: '{"query":"test","limit":10}',
        },
      });
      const curl = service.generateCurl(entry);
      expect(curl).not.toContain('-X POST'); // inferred from --data-raw
      expect(curl).toContain(
        "--data-raw '{\"query\":\"test\",\"limit\":10}'",
      );
      expect(curl).toContain("-H 'Content-Type: application/json'");
    });

    it('should include -X for PUT even with body', () => {
      const entry = makeEntry({
        method: 'PUT',
        postData: {
          mimeType: 'application/json',
          text: '{"name":"updated"}',
        },
      });
      const curl = service.generateCurl(entry);
      expect(curl).toContain('-X PUT');
    });

    it('should skip browser-only headers', () => {
      const entry = makeEntry({
        headers: [
          { name: 'Authorization', value: 'Bearer token123' },
          { name: 'Sec-Fetch-Site', value: 'same-origin' },
          { name: 'Sec-CH-UA', value: '"Chrome"' },
          { name: ':authority', value: 'api.example.com' },
          { name: 'Accept', value: 'application/json' },
          { name: 'Host', value: 'api.example.com' },
          { name: 'Connection', value: 'keep-alive' },
        ],
      });
      const curl = service.generateCurl(entry);
      expect(curl).toContain('Authorization: Bearer token123');
      expect(curl).toContain('Accept: application/json');
      expect(curl).not.toContain('Sec-Fetch-Site');
      expect(curl).not.toContain('Sec-CH-UA');
      expect(curl).not.toContain(':authority');
      expect(curl).not.toContain('Host:');
      expect(curl).not.toContain('Connection:');
    });

    it("should handle single quotes in body (O'Brien problem)", () => {
      const entry = makeEntry({
        method: 'POST',
        postData: {
          mimeType: 'application/json',
          text: '{"name":"O\'Brien"}',
        },
      });
      const curl = service.generateCurl(entry);
      // Should produce escaped single quotes
      expect(curl).toContain('O');
      expect(curl).toContain('Brien');
      // Should contain the '\'' escape sequence for the single quote
      expect(curl).toContain("'\\''");
    });

    it('should handle cookies via -b flag', () => {
      const entry = makeEntry({
        headers: [{ name: 'Cookie', value: 'session=abc123; token=xyz' }],
      });
      const curl = service.generateCurl(entry);
      expect(curl).toContain("-b 'session=abc123; token=xyz'");
      expect(curl).not.toContain("-H 'Cookie:");
    });
  });

  describe('parseCurlToRequest', () => {
    it('should parse a basic GET curl', () => {
      const parsed = service.parseCurlToRequest(
        "curl 'https://api.example.com/data'",
      );
      expect(parsed.url).toBe('https://api.example.com/data');
      expect(parsed.method).toBe('GET');
    });

    it('should parse a POST curl with body', () => {
      const parsed = service.parseCurlToRequest(
        "curl 'https://api.example.com/search' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{\"query\":\"test\"}'",
      );
      expect(parsed.url).toBe('https://api.example.com/search');
      expect(parsed.method).toBe('POST');
      expect(parsed.body).toBe('{"query":"test"}');
      expect(parsed.headers['Content-Type']).toBe('application/json');
    });

    it('should parse explicit method', () => {
      const parsed = service.parseCurlToRequest(
        "curl 'https://api.example.com/item/1' -X DELETE",
      );
      expect(parsed.method).toBe('DELETE');
    });
  });
});
