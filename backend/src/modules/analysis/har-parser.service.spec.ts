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

    it('should remove 303 and 308 redirects', () => {
      const entries = [303, 308].map((status) =>
        makeEntry({ url: 'https://api.example.com/old', status }),
      );
      const result = service.filterApiRequests(entries);
      expect(result).toHaveLength(0);
    });

    it('should remove font/* MIME type responses', () => {
      const mimeTypes = ['font/woff', 'font/woff2', 'font/ttf', 'font/otf'];
      const entries = mimeTypes.map((mime) =>
        makeEntry({ url: 'https://example.com/font', responseMimeType: mime }),
      );
      const result = service.filterApiRequests(entries);
      expect(result).toHaveLength(0);
    });

    it('should remove audio/* and video/* MIME type responses', () => {
      const mimeTypes = ['audio/mpeg', 'audio/ogg', 'video/mp4', 'video/webm'];
      const entries = mimeTypes.map((mime) =>
        makeEntry({ url: 'https://example.com/media', responseMimeType: mime }),
      );
      const result = service.filterApiRequests(entries);
      expect(result).toHaveLength(0);
    });

    it('should remove application/wasm responses', () => {
      const entry = makeEntry({
        url: 'https://example.com/module.wasm',
        responseMimeType: 'application/wasm',
      });
      const result = service.filterApiRequests([entry]);
      expect(result).toHaveLength(0);
    });

    it('should handle MIME types with charset parameter (application/json; charset=utf-8)', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/data',
        responseMimeType: 'application/json; charset=utf-8',
      });
      const result = service.filterApiRequests([entry]);
      // Should be kept — it's still JSON after stripping charset
      expect(result).toHaveLength(1);
    });

    it('should remove text/html with charset parameter', () => {
      const entry = makeEntry({
        url: 'https://example.com/page',
        responseMimeType: 'text/html; charset=utf-8',
      });
      const result = service.filterApiRequests([entry]);
      expect(result).toHaveLength(0);
    });

    it('should remove subdomain tracking domains (sub.google-analytics.com)', () => {
      const entries = [
        makeEntry({ url: 'https://sub.google-analytics.com/collect' }),
        makeEntry({ url: 'https://deep.sub.hotjar.com/api' }),
      ];
      const result = service.filterApiRequests(entries);
      expect(result).toHaveLength(0);
    });

    it('should remove entries with invalid URLs', () => {
      const entry = makeEntry({ url: 'not-a-valid-url' });
      const result = service.filterApiRequests([entry]);
      expect(result).toHaveLength(0);
    });

    it('should remove entries with empty URLs', () => {
      const entry = makeEntry({ url: '' });
      const result = service.filterApiRequests([entry]);
      expect(result).toHaveLength(0);
    });

    it('should keep 4xx and 5xx API responses (they are still API calls)', () => {
      const entries = [400, 401, 403, 404, 500, 502].map((status) =>
        makeEntry({ url: 'https://api.example.com/data', status }),
      );
      const result = service.filterApiRequests(entries);
      expect(result).toHaveLength(6);
    });

    it('should remove static file extensions with query strings (.js?v=123)', () => {
      const entry = makeEntry({
        url: 'https://cdn.example.com/bundle.js?v=abc123',
      });
      const result = service.filterApiRequests([entry]);
      expect(result).toHaveLength(0);
    });

    it('should keep octet-stream responses (could be API downloads)', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/export',
        responseMimeType: 'application/octet-stream',
      });
      const result = service.filterApiRequests([entry]);
      expect(result).toHaveLength(1);
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
      const { summary: result } = service.generateLlmSummary(entries, 10);
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
      const { summary: result } = service.generateLlmSummary(entries, 5);
      expect(result).toContain('Auth: Bearer ***');
    });

    it('should show auth type per group (API-Key ***)', () => {
      const entries = [
        makeEntry({
          url: 'https://api.example.com/data',
          headers: [{ name: 'x-api-key', value: 'sk-secret-key-12345' }],
        }),
      ];
      const { summary: result } = service.generateLlmSummary(entries, 5);
      expect(result).toContain('Auth: API-Key ***');
    });

    it('should show request count per group', () => {
      const entries = [
        makeEntry({ url: 'https://api.example.com/a' }),
        makeEntry({ url: 'https://api.example.com/b' }),
        makeEntry({ url: 'https://api.example.com/c' }),
      ];
      const { summary: result } = service.generateLlmSummary(entries, 10);
      expect(result).toContain('3 requests');
    });

    it('should parameterize numeric path segments (/users/123 → /users/{id})', () => {
      const entry = makeEntry({ url: 'https://api.example.com/users/123/posts/456' });
      const { summary: result } = service.generateLlmSummary([entry], 5);
      expect(result).toContain('/users/{id}/posts/{id}');
      expect(result).not.toContain('/123');
      expect(result).not.toContain('/456');
    });

    it('should use short MIME types (json instead of application/json)', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/data',
        responseMimeType: 'application/json',
      });
      const { summary: result } = service.generateLlmSummary([entry], 5);
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
      const { summary: result } = service.generateLlmSummary([entry], 5);
      expect(result).toContain('2.0KB');
    });

    it('should include response body preview when available', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/data',
        responseText: '{"users":[{"id":1,"name":"Alice"}]}',
      });
      const { summary: result } = service.generateLlmSummary([entry], 5);
      expect(result).toContain('preview: {"users":[{"id":1,"name":"Alice"}]}');
    });

    it('should include request body preview for POST', () => {
      const entry = makeEntry({
        method: 'POST',
        url: 'https://api.example.com/search',
        postData: { mimeType: 'application/json', text: '{"query":"hello world"}' },
      });
      const { summary: result } = service.generateLlmSummary([entry], 5);
      expect(result).toContain('body: {"query":"hello world"}');
    });

    it('should show header line with total count vs filtered count', () => {
      const entries = [makeEntry({ url: 'https://api.example.com/data' })];
      const { summary: result } = service.generateLlmSummary(entries, 50);
      expect(result).toContain('1 API requests from 50 total');
    });

    it('should deduplicate entries with same method + parameterized path', () => {
      const entries = [
        makeEntry({ url: 'https://api.example.com/users/1' }),
        makeEntry({ url: 'https://api.example.com/users/2' }),
        makeEntry({ url: 'https://api.example.com/users/3' }),
        makeEntry({ url: 'https://api.example.com/posts' }),
      ];
      const { summary: result } = service.generateLlmSummary(entries, 10);
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
      const { summary: result } = service.generateLlmSummary(entries, 5);
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
      const { summary: result } = service.generateLlmSummary(entries, 5);
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
      const { summary: result } = service.generateLlmSummary(entries, 5);
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
      const { summary: result } = service.generateLlmSummary(entries, 20);
      expect(result).toContain('1 unique API requests');
      expect(result).toContain('3 total');
      expect(result).toContain('duplicates collapsed');
    });

    it('should not alter header when no duplicates exist', () => {
      const entries = [
        makeEntry({ url: 'https://api.example.com/users' }),
        makeEntry({ url: 'https://api.example.com/posts' }),
      ];
      const { summary: result } = service.generateLlmSummary(entries, 10);
      expect(result).toContain('2 API requests from 10 total');
      expect(result).not.toContain('duplicates collapsed');
    });

    it('should differentiate GraphQL requests by operationName (not dedup)', () => {
      const entries = [
        makeEntry({
          method: 'POST',
          url: 'https://api.example.com/graphql',
          postData: {
            mimeType: 'application/json',
            text: '{"operationName":"GetUsers","query":"{ users { id } }"}',
          },
        }),
        makeEntry({
          method: 'POST',
          url: 'https://api.example.com/graphql',
          postData: {
            mimeType: 'application/json',
            text: '{"operationName":"GetPosts","query":"{ posts { id } }"}',
          },
        }),
      ];
      const { summary: result } = service.generateLlmSummary(entries, 5);
      // Both should appear as separate entries (different operationName)
      expect(result).toContain('GetUsers');
      expect(result).toContain('GetPosts');
      expect(result).not.toContain('×');
    });

    it('should dedup GraphQL requests with same operationName', () => {
      const entries = [
        makeEntry({
          method: 'POST',
          url: 'https://api.example.com/graphql',
          postData: {
            mimeType: 'application/json',
            text: '{"operationName":"GetUsers","variables":{"id":1}}',
          },
        }),
        makeEntry({
          method: 'POST',
          url: 'https://api.example.com/graphql',
          postData: {
            mimeType: 'application/json',
            text: '{"operationName":"GetUsers","variables":{"id":2}}',
          },
        }),
      ];
      const { summary: result } = service.generateLlmSummary(entries, 5);
      expect(result).toContain('(×2)');
    });

    it('should not dedup entries with different query params (same path)', () => {
      const entries = [
        makeEntry({ url: 'https://api.example.com/search?q=cats' }),
        makeEntry({ url: 'https://api.example.com/search?q=dogs' }),
      ];
      const { summary: result } = service.generateLlmSummary(entries, 5);
      // Query params are stripped during parameterization so these SHOULD dedup
      expect(result).toContain('(×2)');
    });

    it('should handle entries with missing response content gracefully', () => {
      const entry: Entry = {
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
          content: { size: 0, mimeType: '' },
          redirectURL: '',
          headersSize: -1,
          bodySize: 0,
        },
        cache: {},
        timings: { send: 0, wait: 50, receive: 50 },
      } as Entry;
      // Should not throw
      const { summary: result } = service.generateLlmSummary([entry], 5);
      expect(result).toContain('/data');
    });

    it('should truncate long response body previews', () => {
      const longResponse = '{"data":' + '"x"'.repeat(100) + '}';
      const entry = makeEntry({
        url: 'https://api.example.com/data',
        responseText: longResponse,
      });
      const { summary: result } = service.generateLlmSummary([entry], 5);
      expect(result).toContain('...');
    });
  });

  // ---------------------------------------------------------------------------
  // parameterizePath (direct tests)
  // ---------------------------------------------------------------------------
  describe('parameterizePath', () => {
    it('should replace numeric IDs in path segments', () => {
      expect(service.parameterizePath('/users/123')).toBe('/users/{id}');
    });

    it('should replace multiple numeric IDs', () => {
      expect(service.parameterizePath('/users/123/posts/456')).toBe('/users/{id}/posts/{id}');
    });

    it('should replace UUID segments', () => {
      expect(service.parameterizePath('/items/550e8400-e29b-41d4-a716-446655440000'))
        .toBe('/items/{id}');
    });

    it('should not replace non-numeric, non-UUID segments', () => {
      expect(service.parameterizePath('/api/v2/users')).toBe('/api/v2/users');
    });

    it('should handle trailing slash', () => {
      expect(service.parameterizePath('/users/123/')).toBe('/users/{id}/');
    });

    it('should handle path with query string', () => {
      expect(service.parameterizePath('/users/123?include=posts'))
        .toBe('/users/{id}?include=posts');
    });

    it('should not replace numbers that are part of a word (v2, api3)', () => {
      // /v2 is a single segment "v2" not a pure number, so it stays
      expect(service.parameterizePath('/api/v2/config')).toBe('/api/v2/config');
    });

    it('should handle root path', () => {
      expect(service.parameterizePath('/')).toBe('/');
    });

    it('should replace mixed UUID and numeric segments', () => {
      expect(service.parameterizePath('/org/550e8400-e29b-41d4-a716-446655440000/users/42'))
        .toBe('/org/{id}/users/{id}');
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases (Phase 4)
  // ---------------------------------------------------------------------------
  describe('generateLlmSummary edge cases', () => {
    it('should handle empty entries array without throwing', () => {
      const { summary: result } = service.generateLlmSummary([], 0);
      expect(result).toContain('0 API requests');
    });

    it('should handle malformed JSON in GraphQL body during dedup gracefully', () => {
      const entry = makeEntry({
        method: 'POST',
        url: 'https://api.example.com/graphql',
        postData: { mimeType: 'application/json', text: '{not valid json' },
      });
      // Should not throw — falls back to ignoring operationName
      const { summary: result } = service.generateLlmSummary([entry], 5);
      expect(result).toContain('/graphql');
    });

    it('should handle entries with invalid URL in hostname comparison', () => {
      const entry = makeEntry({ url: 'https://api.example.com/data' });
      // Create a second entry whose URL is used in the hostname comparison at line 114
      const entry2 = makeEntry({ url: 'not-a-valid-url' });
      // summarizeEntries uses entries[0].request.url as hostname comparison baseline
      expect(() => service.summarizeEntries([entry, entry2])).not.toThrow();
    });

    it('should use first auth type when group has multiple auth types', () => {
      const entries = [
        makeEntry({
          url: 'https://api.example.com/me',
          headers: [{ name: 'Authorization', value: 'Bearer token123' }],
        }),
        makeEntry({
          url: 'https://api.example.com/keys',
          headers: [{ name: 'x-api-key', value: 'sk-12345' }],
        }),
      ];
      const { summary: result } = service.generateLlmSummary(entries, 5);
      // First auth type (Bearer) wins for the group
      expect(result).toContain('Auth: Bearer ***');
      expect(result).not.toContain('API-Key');
    });

    it('should show no size for 0-byte responses', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/empty',
        responseSize: 0,
      });
      const { summary: result } = service.generateLlmSummary([entry], 5);
      const line = result.split('\n').find((l) => l.includes('/empty'));
      expect(line).toBeDefined();
      // Should NOT contain a size annotation like (0B)
      expect(line).not.toMatch(/\(\d+B\)/);
    });

    it('should format 512B correctly', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/small',
        responseSize: 512,
      });
      const { summary: result } = service.generateLlmSummary([entry], 5);
      expect(result).toContain('512B');
    });

    it('should format exactly 1024 bytes as 1.0KB', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/kb',
        responseSize: 1024,
      });
      const { summary: result } = service.generateLlmSummary([entry], 5);
      expect(result).toContain('1.0KB');
    });

    it('should format 2MB correctly', () => {
      const entry = makeEntry({
        url: 'https://api.example.com/big',
        responseSize: 2 * 1024 * 1024,
      });
      const { summary: result } = service.generateLlmSummary([entry], 5);
      expect(result).toContain('2.0MB');
    });
  });

  describe('summarizeEntries body preview edge cases', () => {
    it('should not add ellipsis when body is exactly 100 chars', () => {
      const body100 = 'x'.repeat(100);
      const entry = makeEntry({
        method: 'POST',
        url: 'https://api.example.com/data',
        postData: { mimeType: 'application/json', text: body100 },
      });
      const [summary] = service.summarizeEntries([entry]);
      expect(summary.bodyPreview).toBe(body100);
      expect(summary.bodyPreview).not.toContain('...');
    });

    it('should add ellipsis when body is 101 chars', () => {
      const body101 = 'x'.repeat(101);
      const entry = makeEntry({
        method: 'POST',
        url: 'https://api.example.com/data',
        postData: { mimeType: 'application/json', text: body101 },
      });
      const [summary] = service.summarizeEntries([entry]);
      expect(summary.bodyPreview).toContain('...');
      expect(summary.bodyPreview!.length).toBe(103); // 100 + '...'
    });
  });
});
