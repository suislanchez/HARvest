import { AnalysisService } from './analysis.service';
import { HarParserService } from './har-parser.service';
import { HarToCurlService } from './har-to-curl.service';
import { WsCommandService } from './ws-command.service';
import { LlmProvider } from '../llm/llm-provider.interface';
import type { Har, Entry } from 'har-format';

describe('AnalysisService', () => {
  let service: AnalysisService;
  let harParser: HarParserService;
  let harToCurl: HarToCurlService;
  let wsCommand: WsCommandService;
  let llm: jest.Mocked<LlmProvider>;

  function makeEntry(url: string, method = 'GET'): Entry {
    return {
      startedDateTime: '2024-01-01T00:00:00.000Z',
      time: 150,
      request: {
        method,
        url,
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
        headers: [{ name: 'Content-Type', value: 'application/json' }],
        content: { size: 100, mimeType: 'application/json' },
        redirectURL: '',
        headersSize: -1,
        bodySize: 100,
      },
      cache: {},
      timings: { send: 0, wait: 100, receive: 50 },
    } as Entry;
  }

  function makeHarBuffer(entries: Entry[]): Buffer {
    const har: Har = {
      log: {
        version: '1.2',
        creator: { name: 'test', version: '1.0' },
        entries,
      },
    } as Har;
    return Buffer.from(JSON.stringify(har));
  }

  beforeEach(() => {
    harParser = new HarParserService();
    harToCurl = new HarToCurlService();
    wsCommand = new WsCommandService();
    llm = {
      identifyApiRequest: jest.fn(),
    } as any;
    service = new AnalysisService(harParser, harToCurl, wsCommand, llm);
  });

  it('should run the full pipeline and return curl + metadata', async () => {
    const entries = [
      makeEntry('https://api.example.com/users'),
      makeEntry('https://api.example.com/posts'),
    ];
    const buffer = makeHarBuffer(entries);

    llm.identifyApiRequest.mockResolvedValue({
      matchIndex: 0,
      confidence: 0.95,
      reason: 'Matches user endpoint',
      topMatches: [
        { index: 0, confidence: 0.95, reason: 'Matches user endpoint' },
        { index: 1, confidence: 0.3, reason: 'Less likely' },
      ],
      promptTokens: 100,
      completionTokens: 20,
    });

    const result = await service.analyzeHar(buffer, 'the users API');

    expect(result.curl).toContain('https://api.example.com/users');
    expect(result.matchedRequest.method).toBe('GET');
    expect(result.matchedRequest.url).toBe('https://api.example.com/users');
    expect(result.confidence).toBe(0.95);
    expect(result.reason).toBe('Matches user endpoint');
    expect(result.topMatches).toHaveLength(2);
    expect(result.stats.totalRequests).toBe(2);
    expect(result.stats.filteredRequests).toBe(2);
    expect(result.stats.promptTokens).toBe(100);
  });

  it('should throw when all entries are filtered out', async () => {
    // Only static assets — all will be filtered
    const entries = [
      makeEntry('https://cdn.example.com/bundle.js'),
      makeEntry('https://cdn.example.com/style.css'),
    ];
    // Override MIME types so they get filtered
    entries[0].response.content.mimeType = 'application/javascript';
    entries[1].response.content.mimeType = 'text/css';
    const buffer = makeHarBuffer(entries);

    await expect(service.analyzeHar(buffer, 'some api')).rejects.toThrow(
      'No API requests found',
    );
    expect(llm.identifyApiRequest).not.toHaveBeenCalled();
  });

  it('should populate allRequests with all entries (not just filtered)', async () => {
    const apiEntry = makeEntry('https://api.example.com/data');
    const jsEntry = makeEntry('https://cdn.example.com/app.js');
    jsEntry.response.content.mimeType = 'application/javascript';
    const entries = [apiEntry, jsEntry];
    const buffer = makeHarBuffer(entries);

    llm.identifyApiRequest.mockResolvedValue({
      matchIndex: 0,
      confidence: 0.9,
      reason: 'Data API',
      topMatches: [{ index: 0, confidence: 0.9, reason: 'Data API' }],
      promptTokens: 50,
      completionTokens: 10,
    });

    const result = await service.analyzeHar(buffer, 'data api');

    // allRequests includes ALL entries (unfiltered)
    expect(result.allRequests).toHaveLength(2);
    expect(result.allRequests[0].url).toBe('https://api.example.com/data');
    expect(result.allRequests[1].url).toBe('https://cdn.example.com/app.js');
    // But filteredRequests should be 1
    expect(result.stats.filteredRequests).toBe(1);
  });

  it('should pass the correct summary to LLM', async () => {
    const entries = [makeEntry('https://api.example.com/users')];
    const buffer = makeHarBuffer(entries);

    llm.identifyApiRequest.mockResolvedValue({
      matchIndex: 0,
      confidence: 0.9,
      reason: 'Match',
      topMatches: [{ index: 0, confidence: 0.9, reason: 'Match' }],
      promptTokens: 50,
      completionTokens: 10,
    });

    await service.analyzeHar(buffer, 'users endpoint');

    expect(llm.identifyApiRequest).toHaveBeenCalledTimes(1);
    const [summary, description, count] = llm.identifyApiRequest.mock.calls[0];
    expect(summary).toContain('api.example.com');
    expect(summary).toContain('/users');
    expect(description).toBe('users endpoint');
    expect(count).toBe(1);
  });

  it('should include entry time in allRequests', async () => {
    const entry = makeEntry('https://api.example.com/slow');
    entry.time = 2500;
    const buffer = makeHarBuffer([entry]);

    llm.identifyApiRequest.mockResolvedValue({
      matchIndex: 0,
      confidence: 0.9,
      reason: 'Match',
      topMatches: [{ index: 0, confidence: 0.9, reason: 'Match' }],
      promptTokens: 50,
      completionTokens: 10,
    });

    const result = await service.analyzeHar(buffer, 'slow api');
    expect(result.allRequests[0].time).toBe(2500);
  });

  it('should handle entries with missing time gracefully', async () => {
    const entry = makeEntry('https://api.example.com/data');
    (entry as any).time = undefined;
    const buffer = makeHarBuffer([entry]);

    llm.identifyApiRequest.mockResolvedValue({
      matchIndex: 0,
      confidence: 0.9,
      reason: 'Match',
      topMatches: [{ index: 0, confidence: 0.9, reason: 'Match' }],
      promptTokens: 50,
      completionTokens: 10,
    });

    const result = await service.analyzeHar(buffer, 'data');
    expect(result.allRequests[0].time).toBe(0);
  });

  it('should strip charset from matchedRequest contentType', async () => {
    const entry = makeEntry('https://api.example.com/data');
    entry.response.content.mimeType = 'application/json; charset=utf-8';
    const buffer = makeHarBuffer([entry]);

    llm.identifyApiRequest.mockResolvedValue({
      matchIndex: 0,
      confidence: 0.9,
      reason: 'Match',
      topMatches: [{ index: 0, confidence: 0.9, reason: 'Match' }],
      promptTokens: 50,
      completionTokens: 10,
    });

    const result = await service.analyzeHar(buffer, 'data');
    expect(result.matchedRequest.contentType).toBe('application/json');
  });
});
