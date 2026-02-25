import { BadRequestException } from '@nestjs/common';
import { HarParserService } from './har-parser.service';
import type { Entry } from 'har-format';

describe('HarParserService', () => {
  let service: HarParserService;

  beforeEach(() => {
    service = new HarParserService();
  });

  function makeEntry(
    overrides: Partial<{
      method: string;
      url: string;
      headers: Array<{ name: string; value: string }>;
      postData: { mimeType: string; text: string } | undefined;
      status: number;
      responseMimeType: string;
      responseHeaders: Array<{ name: string; value: string }>;
      responseSize: number;
      responseText: string;
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
        headers: overrides.responseHeaders ?? [
          { name: 'Content-Type', value: overrides.responseMimeType ?? 'application/json' },
        ],
        content: {
          size: overrides.responseSize ?? 100,
          mimeType: overrides.responseMimeType ?? 'application/json',
          ...(overrides.responseText !== undefined ? { text: overrides.responseText } : {}),
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: overrides.responseSize ?? 100,
      },
      cache: {},
      timings: { send: 0, wait: 50, receive: 50 },
    } as Entry;
  }

  // ---------------------------------------------------------------------------
  // parseHar
  // ---------------------------------------------------------------------------
  describe('parseHar', () => {
    it('should parse valid HAR JSON successfully', () => {
      const har = {
        log: {
          version: '1.2',
          creator: { name: 'test', version: '1.0' },
          entries: [
            {
              startedDateTime: '2024-01-01T00:00:00.000Z',
              time: 100,
              request: {
                method: 'GET',
                url: 'https://api.example.com/data',
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
            },
          ],
        },
      };
      const buffer = Buffer.from(JSON.stringify(har));
      const result = service.parseHar(buffer);

      expect(result.log).toBeDefined();
      expect(result.log.entries).toHaveLength(1);
      expect(result.log.entries[0].request.method).toBe('GET');
    });

    it('should throw BadRequestException for invalid JSON', () => {
      const buffer = Buffer.from('not valid json {{{');
      expect(() => service.parseHar(buffer)).toThrow(BadRequestException);
      expect(() => service.parseHar(buffer)).toThrow('Invalid JSON');
    });

    it('should throw BadRequestException when log.entries is missing', () => {
      const noEntries = { log: { version: '1.2' } };
      const buffer = Buffer.from(JSON.stringify(noEntries));
      expect(() => service.parseHar(buffer)).toThrow(BadRequestException);
      expect(() => service.parseHar(buffer)).toThrow('missing log.entries');
    });

    it('should accept an empty entries array as valid', () => {
      const har = {
        log: {
          version: '1.2',
          creator: { name: 'test', version: '1.0' },
          entries: [],
        },
      };
      const buffer = Buffer.from(JSON.stringify(har));
      const result = service.parseHar(buffer);

      expect(result.log.entries).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // filterApiRequests
  // ---------------------------------------------------------------------------
  describe('filterApiRequests', () => {
    it('should keep standard API requests', () => {
      const entry = makeEntry({
        method: 'GET',
        url: 'https://api.example.com/api/data',
        status: 200,
        responseMimeType: 'application/json',
      });
      const result = service.filterApiRequests([entry]);
      expect(result).toHaveLength(1);
    });

    it('should remove requests for static file extensions (.js, .css, .png, .woff2, .svg, .map)', () => {
      const extensions = ['.js', '.css', '.png', '.woff2', '.svg', '.map'];
      const entries = extensions.map((ext) =>
        makeEntry({ url: `https://cdn.example.com/static/bundle${ext}` }),
      );
      const result = service.filterApiRequests(entries);
      expect(result).toHaveLength(0);
    });

    it('should remove tracking domains (google-analytics.com, facebook.com, googletagmanager.com)', () => {
      const trackingUrls = [
        'https://www.google-analytics.com/collect?v=1',
        'https://www.facebook.com/tr',
        'https://www.googletagmanager.com/gtm.js',
      ];
      const entries = trackingUrls.map((url) => makeEntry({ url }));
      const result = service.filterApiRequests(entries);
      expect(result).toHaveLength(0);
    });

    it('should remove text/html responses', () => {
      const entry = makeEntry({
        url: 'https://example.com/page',
        responseMimeType: 'text/html',
      });
      const result = service.filterApiRequests([entry]);
      expect(result).toHaveLength(0);
    });

    it('should remove application/javascript responses', () => {
      const entry = makeEntry({
        url: 'https://example.com/script',
        responseMimeType: 'application/javascript',
      });
      const result = service.filterApiRequests([entry]);
      expect(result).toHaveLength(0);
    });

    it('should remove image/* responses', () => {
      const mimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
      const entries = mimeTypes.map((mime) =>
        makeEntry({ url: 'https://example.com/resource', responseMimeType: mime }),
      );
      const result = service.filterApiRequests(entries);
      expect(result).toHaveLength(0);
    });

    it('should remove OPTIONS preflight requests', () => {
      const entry = makeEntry({
        method: 'OPTIONS',
        url: 'https://api.example.com/data',
      });
      const result = service.filterApiRequests([entry]);
      expect(result).toHaveLength(0);
    });

    it('should remove status 0 (failed/aborted requests)', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/data',
        status: 0,
      });
      const result = service.filterApiRequests([entry]);
      expect(result).toHaveLength(0);
    });

    it('should remove redirects (301, 302, 307)', () => {
      const entries = [301, 302, 307].map((status) =>
        makeEntry({ url: 'https://api.example.com/old', status }),
      );
      const result = service.filterApiRequests(entries);
      expect(result).toHaveLength(0);
    });

    it('should keep application/json, text/plain, and application/xml responses', () => {
      const mimeTypes = ['application/json', 'text/plain', 'application/xml'];
      const entries = mimeTypes.map((mime) =>
        makeEntry({ url: 'https://api.example.com/data', responseMimeType: mime }),
      );
      const result = service.filterApiRequests(entries);
      expect(result).toHaveLength(3);
    });

    it('should keep requests with no/unknown content type (conservative)', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/data',
        responseMimeType: '',
      });
      const result = service.filterApiRequests([entry]);
      expect(result).toHaveLength(1);
    });

    it('should remove data: URIs', () => {
      const entry = makeEntry({
        url: 'data:application/json;base64,eyJ0ZXN0Ijp0cnVlfQ==',
      });
      const result = service.filterApiRequests([entry]);
      expect(result).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // summarizeEntries
  // ---------------------------------------------------------------------------
  describe('summarizeEntries', () => {
    it('should produce correct index numbering', () => {
      const entries = [
        makeEntry({ url: 'https://api.example.com/a' }),
        makeEntry({ url: 'https://api.example.com/b' }),
        makeEntry({ url: 'https://api.example.com/c' }),
      ];
      const summaries = service.summarizeEntries(entries);
      expect(summaries[0].index).toBe(0);
      expect(summaries[1].index).toBe(1);
      expect(summaries[2].index).toBe(2);
      expect(summaries[0].summary).toMatch(/^0\./);
      expect(summaries[1].summary).toMatch(/^1\./);
      expect(summaries[2].summary).toMatch(/^2\./);
    });

    it('should include method and URL path in summary', () => {
      const entry = makeEntry({
        method: 'GET',
        url: 'https://api.example.com/users?page=1',
      });
      const [summary] = service.summarizeEntries([entry]);
      expect(summary.method).toBe('GET');
      expect(summary.summary).toContain('GET');
      expect(summary.summary).toContain('/users?page=1');
    });

    it('should detect [AUTH] flag from Authorization header', () => {
      const entry = makeEntry({
        headers: [{ name: 'Authorization', value: 'Bearer token123' }],
      });
      const [summary] = service.summarizeEntries([entry]);
      expect(summary.hasAuth).toBe(true);
      expect(summary.summary).toContain('[AUTH]');
    });

    it('should detect [AUTH] flag from x-api-key header', () => {
      const entry = makeEntry({
        headers: [{ name: 'x-api-key', value: 'sk-12345' }],
      });
      const [summary] = service.summarizeEntries([entry]);
      expect(summary.hasAuth).toBe(true);
      expect(summary.summary).toContain('[AUTH]');
    });

    it('should include body preview for POST requests', () => {
      const entry = makeEntry({
        method: 'POST',
        url: 'https://api.example.com/search',
        postData: { mimeType: 'application/json', text: '{"query":"test"}' },
      });
      const [summary] = service.summarizeEntries([entry]);
      expect(summary.bodyPreview).toContain('{"query":"test"}');
      expect(summary.summary).toContain('body: {"query":"test"}');
    });

    it('should truncate long URLs', () => {
      const longPath = '/api/' + 'a'.repeat(200);
      const entry = makeEntry({
        url: `https://api.example.com${longPath}`,
      });
      const [summary] = service.summarizeEntries([entry]);
      expect(summary.summary.length).toBeLessThan(
        `0. GET ${longPath} → application/json 200`.length,
      );
      expect(summary.summary).toContain('...');
    });
  });

  // ---------------------------------------------------------------------------
  // generateLlmSummary
  // ---------------------------------------------------------------------------
  describe('generateLlmSummary', () => {
    it('should group entries by hostname', () => {
      const entries = [
        makeEntry({ url: 'https://api.example.com/users' }),
        makeEntry({ url: 'https://api.example.com/posts' }),
        makeEntry({ url: 'https://other-api.io/items' }),
      ];
      const result = service.generateLlmSummary(entries, 10);
      expect(result).toContain('[api.example.com]');
      expect(result).toContain('[other-api.io]');
    });

    it('should show auth type per group (Bearer ***)', () => {
      const entries = [
        makeEntry({
          url: 'https://api.example.com/me',
          headers: [{ name: 'Authorization', value: 'Bearer eyJhbGciOiJIUzI1NiJ9' }],
        }),
      ];
      const result = service.generateLlmSummary(entries, 5);
      expect(result).toContain('Auth: Bearer ***');
    });

    it('should show auth type per group (API-Key ***)', () => {
      const entries = [
        makeEntry({
          url: 'https://api.example.com/data',
          headers: [{ name: 'x-api-key', value: 'sk-secret-key-12345' }],
        }),
      ];
      const result = service.generateLlmSummary(entries, 5);
      expect(result).toContain('Auth: API-Key ***');
    });

    it('should show request count per group', () => {
      const entries = [
        makeEntry({ url: 'https://api.example.com/a' }),
        makeEntry({ url: 'https://api.example.com/b' }),
        makeEntry({ url: 'https://api.example.com/c' }),
      ];
      const result = service.generateLlmSummary(entries, 10);
      expect(result).toContain('3 requests');
    });

    it('should parameterize numeric path segments (/users/123 → /users/{id})', () => {
      const entry = makeEntry({ url: 'https://api.example.com/users/123/posts/456' });
      const result = service.generateLlmSummary([entry], 5);
      expect(result).toContain('/users/{id}/posts/{id}');
      expect(result).not.toContain('/123');
      expect(result).not.toContain('/456');
    });

    it('should use short MIME types (json instead of application/json)', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/data',
        responseMimeType: 'application/json',
      });
      const result = service.generateLlmSummary([entry], 5);
      // Should contain "json" but NOT "application/json" in the entry line
      const entryLine = result.split('\n').find((l) => l.includes('/data'));
      expect(entryLine).toBeDefined();
      expect(entryLine).toContain(' json');
      expect(entryLine).not.toContain('application/json');
    });

    it('should show response size', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/data',
        responseSize: 2048,
      });
      const result = service.generateLlmSummary([entry], 5);
      expect(result).toContain('2.0KB');
    });

    it('should include response body preview when available', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/data',
        responseText: '{"users":[{"id":1,"name":"Alice"}]}',
      });
      const result = service.generateLlmSummary([entry], 5);
      expect(result).toContain('preview: {"users":[{"id":1,"name":"Alice"}]}');
    });

    it('should include request body preview for POST', () => {
      const entry = makeEntry({
        method: 'POST',
        url: 'https://api.example.com/search',
        postData: { mimeType: 'application/json', text: '{"query":"hello world"}' },
      });
      const result = service.generateLlmSummary([entry], 5);
      expect(result).toContain('body: {"query":"hello world"}');
    });

    it('should show header line with total count vs filtered count', () => {
      const entries = [makeEntry({ url: 'https://api.example.com/data' })];
      const result = service.generateLlmSummary(entries, 50);
      expect(result).toContain('1 API requests from 50 total');
    });

    it('should deduplicate entries with same method + parameterized path', () => {
      const entries = [
        makeEntry({ url: 'https://api.example.com/users/1' }),
        makeEntry({ url: 'https://api.example.com/users/2' }),
        makeEntry({ url: 'https://api.example.com/users/3' }),
        makeEntry({ url: 'https://api.example.com/posts' }),
      ];
      const result = service.generateLlmSummary(entries, 10);
      // Should show ×3 for the deduplicated users/{id} group
      expect(result).toContain('(×3)');
      // Should only show one /users/{id} line, not three
      const userLines = result.split('\n').filter((l) => l.includes('/users/{id}'));
      expect(userLines).toHaveLength(1);
      // Should still show /posts normally without a ×N marker
      const postsLine = result.split('\n').find((l) => l.includes('/posts'));
      expect(postsLine).toBeDefined();
      expect(postsLine).not.toContain('×');
    });

    it('should preserve the first entry index when deduplicating', () => {
      const entries = [
        makeEntry({ url: 'https://api.example.com/items/100' }),
        makeEntry({ url: 'https://api.example.com/items/200' }),
      ];
      const result = service.generateLlmSummary(entries, 5);
      // The first entry (index 0) should be the representative
      expect(result).toContain('0.');
      // The second entry (index 1) should be collapsed away
      const lines = result.split('\n').filter((l) => l.trim().startsWith('1.'));
      expect(lines).toHaveLength(0);
    });

    it('should not deduplicate entries with different methods', () => {
      const entries = [
        makeEntry({ method: 'GET', url: 'https://api.example.com/users/1' }),
        makeEntry({ method: 'DELETE', url: 'https://api.example.com/users/2' }),
      ];
      const result = service.generateLlmSummary(entries, 5);
      // Both should appear — different methods are different endpoints
      expect(result).toContain('GET');
      expect(result).toContain('DELETE');
      expect(result).not.toContain('×');
    });

    it('should deduplicate UUID path segments', () => {
      const entries = [
        makeEntry({ url: 'https://api.example.com/items/550e8400-e29b-41d4-a716-446655440000' }),
        makeEntry({ url: 'https://api.example.com/items/6ba7b810-9dad-11d1-80b4-00c04fd430c8' }),
      ];
      const result = service.generateLlmSummary(entries, 5);
      expect(result).toContain('/items/{id}');
      expect(result).toContain('(×2)');
      const itemLines = result.split('\n').filter((l) => l.includes('/items/{id}'));
      expect(itemLines).toHaveLength(1);
    });

    it('should show updated header when dedup reduces count', () => {
      const entries = [
        makeEntry({ url: 'https://api.example.com/users/1' }),
        makeEntry({ url: 'https://api.example.com/users/2' }),
        makeEntry({ url: 'https://api.example.com/users/3' }),
      ];
      const result = service.generateLlmSummary(entries, 20);
      expect(result).toContain('1 unique API requests');
      expect(result).toContain('3 total');
      expect(result).toContain('duplicates collapsed');
    });

    it('should not alter header when no duplicates exist', () => {
      const entries = [
        makeEntry({ url: 'https://api.example.com/users' }),
        makeEntry({ url: 'https://api.example.com/posts' }),
      ];
      const result = service.generateLlmSummary(entries, 10);
      expect(result).toContain('2 API requests from 10 total');
      expect(result).not.toContain('duplicates collapsed');
    });
  });
});
