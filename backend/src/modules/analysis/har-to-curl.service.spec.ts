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

    it('should generate DELETE without body (needs -X DELETE)', () => {
      const entry = makeEntry({
        method: 'DELETE',
        url: 'https://api.example.com/items/42',
      });
      const curl = service.generateCurl(entry);
      expect(curl).toContain('-X DELETE');
      expect(curl).not.toContain('--data-raw');
    });

    it('should generate PATCH with body (needs -X PATCH)', () => {
      const entry = makeEntry({
        method: 'PATCH',
        url: 'https://api.example.com/users/1',
        headers: [{ name: 'Content-Type', value: 'application/json' }],
        postData: { mimeType: 'application/json', text: '{"name":"updated"}' },
      });
      const curl = service.generateCurl(entry);
      expect(curl).toContain('-X PATCH');
      expect(curl).toContain("--data-raw '{\"name\":\"updated\"}'");
    });

    it('should handle empty postData.text (no --data-raw emitted)', () => {
      const entry = makeEntry({
        method: 'POST',
        postData: { mimeType: 'application/json', text: '' },
      });
      const curl = service.generateCurl(entry);
      expect(curl).not.toContain('--data-raw');
    });

    it('should handle URL with ampersands and special characters', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/search?q=hello+world&lang=en&page=1',
      });
      const curl = service.generateCurl(entry);
      // Single-quoted URL prevents shell expansion of &
      expect(curl).toContain("'https://api.example.com/search?q=hello+world&lang=en&page=1'");
    });

    it('should handle URL with dollar signs (no shell variable expansion)', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/price?min=$10&max=$100',
      });
      const curl = service.generateCurl(entry);
      expect(curl).toContain('$10');
      expect(curl).toContain('$100');
    });

    it('should handle form-urlencoded body', () => {
      const entry = makeEntry({
        method: 'POST',
        headers: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
        postData: {
          mimeType: 'application/x-www-form-urlencoded',
          text: 'username=admin&password=secret',
        },
      });
      const curl = service.generateCurl(entry);
      expect(curl).toContain("--data-raw 'username=admin&password=secret'");
      expect(curl).toContain("-H 'Content-Type: application/x-www-form-urlencoded'");
    });

    it('should handle multiple headers correctly', () => {
      const entry = makeEntry({
        headers: [
          { name: 'Authorization', value: 'Bearer tok123' },
          { name: 'Accept', value: 'application/json' },
          { name: 'X-Request-ID', value: 'abc-def' },
        ],
      });
      const curl = service.generateCurl(entry);
      expect(curl).toContain("-H 'Authorization: Bearer tok123'");
      expect(curl).toContain("-H 'Accept: application/json'");
      expect(curl).toContain("-H 'X-Request-ID: abc-def'");
    });

    it('should handle body with @ character (--data-raw prevents file read)', () => {
      const entry = makeEntry({
        method: 'POST',
        postData: {
          mimeType: 'application/json',
          text: '{"email":"user@example.com"}',
        },
      });
      const curl = service.generateCurl(entry);
      // --data-raw is critical here: -d would interpret @example.com as a file
      expect(curl).toContain('--data-raw');
      expect(curl).toContain('user@example.com');
    });

    it('should handle body with backticks and exclamation marks', () => {
      const entry = makeEntry({
        method: 'POST',
        postData: {
          mimeType: 'application/json',
          text: '{"msg":"Hello! Use `code` here"}',
        },
      });
      const curl = service.generateCurl(entry);
      // Single quotes prevent ! and ` expansion
      expect(curl).toContain('Hello!');
      expect(curl).toContain('`code`');
    });

    it('should handle HEAD method', () => {
      const entry = makeEntry({
        method: 'HEAD',
        url: 'https://api.example.com/health',
      });
      const curl = service.generateCurl(entry);
      expect(curl).toContain('-X HEAD');
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

    it('should parse cookies via -b flag', () => {
      const parsed = service.parseCurlToRequest(
        "curl 'https://api.example.com/me' -b 'session=abc; token=xyz'",
      );
      expect(parsed.headers['Cookie']).toBe('session=abc; token=xyz');
    });

    it('should parse -d as POST body', () => {
      const parsed = service.parseCurlToRequest(
        "curl 'https://api.example.com/login' -d 'user=admin'",
      );
      expect(parsed.method).toBe('POST');
      expect(parsed.body).toBe('user=admin');
    });

    it('should parse --data as POST body', () => {
      const parsed = service.parseCurlToRequest(
        "curl 'https://api.example.com/login' --data 'user=admin'",
      );
      expect(parsed.method).toBe('POST');
      expect(parsed.body).toBe('user=admin');
    });

    it('should respect explicit -X even with body', () => {
      const parsed = service.parseCurlToRequest(
        "curl 'https://api.example.com/item/1' -X PUT --data-raw '{\"name\":\"new\"}'",
      );
      expect(parsed.method).toBe('PUT');
      expect(parsed.body).toBe('{"name":"new"}');
    });

    it('should handle double-quoted strings', () => {
      const parsed = service.parseCurlToRequest(
        'curl "https://api.example.com/data" -H "Accept: application/json"',
      );
      expect(parsed.url).toBe('https://api.example.com/data');
      expect(parsed.headers['Accept']).toBe('application/json');
    });

    it('should skip --compressed flag', () => {
      const parsed = service.parseCurlToRequest(
        "curl 'https://api.example.com/data' --compressed",
      );
      expect(parsed.url).toBe('https://api.example.com/data');
      expect(parsed.method).toBe('GET');
    });
  });

  describe('generateCurl edge cases', () => {
    it('should preserve newlines inside JSON body', () => {
      const entry = makeEntry({
        method: 'POST',
        headers: [{ name: 'Content-Type', value: 'application/json' }],
        postData: {
          mimeType: 'application/json',
          text: '{"msg":"line1\\nline2"}',
        },
      });
      const curl = service.generateCurl(entry);
      // Single-quoted body preserves literal backslash-n
      expect(curl).toContain('line1\\nline2');
    });

    it('should handle unicode in URL (percent-encoded)', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/search?q=%E4%BD%A0%E5%A5%BD',
      });
      const curl = service.generateCurl(entry);
      expect(curl).toContain('%E4%BD%A0%E5%A5%BD');
    });

    it('should preserve unicode characters in body', () => {
      const entry = makeEntry({
        method: 'POST',
        postData: {
          mimeType: 'application/json',
          text: '{"name":"日本語テスト"}',
        },
      });
      const curl = service.generateCurl(entry);
      const parsed = service.parseCurlToRequest(curl);
      expect(parsed.body).toBe('{"name":"日本語テスト"}');
    });

    it('should handle header values with multiple colons', () => {
      const entry = makeEntry({
        headers: [
          { name: 'Authorization', value: 'Bearer eyJ.payload:extra:data' },
        ],
      });
      const curl = service.generateCurl(entry);
      const parsed = service.parseCurlToRequest(curl);
      expect(parsed.headers['Authorization']).toBe('Bearer eyJ.payload:extra:data');
    });
  });

  describe('parseCurlToRequest edge cases', () => {
    it('should handle unclosed single quote by reading to EOF', () => {
      // The tokenizer reads to EOF if no closing quote found
      const parsed = service.parseCurlToRequest("curl 'https://api.example.com/data");
      expect(parsed.url).toBe('https://api.example.com/data');
    });

    it('should skip empty quoted string', () => {
      const parsed = service.parseCurlToRequest("curl '' -X GET 'https://api.example.com/data'");
      // Empty token is skipped, URL should be the non-empty one
      expect(parsed.url).toBe('https://api.example.com/data');
    });
  });

  describe('roundtrip: generateCurl → parseCurlToRequest', () => {
    it('should roundtrip a GET request', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/users?page=2&limit=10',
        headers: [
          { name: 'Authorization', value: 'Bearer mytoken' },
          { name: 'Accept', value: 'application/json' },
        ],
      });
      const curl = service.generateCurl(entry);
      const parsed = service.parseCurlToRequest(curl);
      expect(parsed.url).toBe('https://api.example.com/users?page=2&limit=10');
      expect(parsed.method).toBe('GET');
      expect(parsed.headers['Authorization']).toBe('Bearer mytoken');
      expect(parsed.headers['Accept']).toBe('application/json');
    });

    it('should roundtrip a POST request with JSON body', () => {
      const entry = makeEntry({
        method: 'POST',
        url: 'https://api.example.com/graphql',
        headers: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Authorization', value: 'Bearer tok' },
        ],
        postData: {
          mimeType: 'application/json',
          text: '{"query":"{ users { id name } }"}',
        },
      });
      const curl = service.generateCurl(entry);
      const parsed = service.parseCurlToRequest(curl);
      expect(parsed.url).toBe('https://api.example.com/graphql');
      expect(parsed.method).toBe('POST');
      expect(parsed.body).toBe('{"query":"{ users { id name } }"}');
      expect(parsed.headers['Content-Type']).toBe('application/json');
    });

    it('should roundtrip a DELETE request', () => {
      const entry = makeEntry({
        method: 'DELETE',
        url: 'https://api.example.com/items/99',
        headers: [{ name: 'Authorization', value: 'Bearer tok' }],
      });
      const curl = service.generateCurl(entry);
      const parsed = service.parseCurlToRequest(curl);
      expect(parsed.url).toBe('https://api.example.com/items/99');
      expect(parsed.method).toBe('DELETE');
    });
  });
});
