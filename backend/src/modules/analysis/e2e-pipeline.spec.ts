/**
 * True End-to-End Pipeline Tests
 *
 * Tests the EXACT same entry point the controller uses:
 *   AnalysisService.analyzeHar(buffer, description)
 *
 * This exercises the full pipeline:
 *   HAR buffer → parse → filter → deduplicate → summarize → LLM match → curl gen
 *
 * Then EXECUTES the returned curl against the live API to verify it works.
 *
 * Run with:
 *   cd backend && npx jest e2e-pipeline --testTimeout=120000 --verbose
 */

import * as fs from 'fs';
import * as path from 'path';
import { AnalysisService, AnalysisResult } from './analysis.service';
import { HarParserService } from './har-parser.service';
import { HarToCurlService } from './har-to-curl.service';
import { OpenaiService } from '../openai/openai.service';
import { ConfigService } from '@nestjs/config';

// Skip entire suite if no API key
const apiKey = process.env.OPENAI_API_KEY;
const describeIf = apiKey ? describe : describe.skip;

describeIf('E2E Pipeline — Full analyzeHar() → Execute', () => {
  let service: AnalysisService;
  let harParser: HarParserService;
  let harToCurl: HarToCurlService;
  let openai: OpenaiService;

  const fixturesDir = path.resolve(__dirname, '../../../../test-fixtures');
  const capturedDir = path.join(fixturesDir, 'captured');

  beforeAll(() => {
    harParser = new HarParserService();
    harToCurl = new HarToCurlService();

    const configService = {
      get: (key: string) => {
        if (key === 'OPENAI_API_KEY') return apiKey;
        if (key === 'OPENAI_MODEL') return process.env.OPENAI_MODEL || 'gpt-4o-mini';
        return undefined;
      },
    } as unknown as ConfigService;

    openai = new OpenaiService(configService);
    service = new AnalysisService(harParser, harToCurl, openai);
  });

  // ---------------------------------------------------------------------------
  // Helper: execute a curl result via fetch
  // ---------------------------------------------------------------------------
  async function executeCurl(curl: string): Promise<{ status: number; body: any; text: string }> {
    const parsed = harToCurl.parseCurlToRequest(curl);
    const fetchRes = await fetch(parsed.url, {
      method: parsed.method,
      headers: parsed.headers,
      body: parsed.body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await fetchRes.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: fetchRes.status, body, text };
  }

  // ---------------------------------------------------------------------------
  // Helper: collect results for summary table
  // ---------------------------------------------------------------------------
  interface PipelineResult {
    name: string;
    passed: boolean;
    executed: boolean;
    matchedUrl: string;
    confidence: number;
    totalEntries: number;
    filteredEntries: number;
    durationMs: number;
    execStatus?: number;
  }

  const results: PipelineResult[] = [];

  // ---------------------------------------------------------------------------
  // Section 1: Existing real HAR files (assignment test cases + execute)
  // ---------------------------------------------------------------------------
  describe('Assignment HAR files → full pipeline + execution', () => {
    it('JokeAPI: analyzeHar() → execute curl → get 5 jokes', async () => {
      const harPath = path.join(fixturesDir, 'jokes-real.har');
      if (!fs.existsSync(harPath)) return;

      const buffer = fs.readFileSync(harPath);
      const start = Date.now();
      const result = await service.analyzeHar(buffer, 'give me a curl command to get 5 jokes via API');
      const elapsed = Date.now() - start;

      // Pipeline assertions
      expect(result.matchedRequest.url).toContain('v2.jokeapi.dev/joke/Any');
      expect(result.matchedRequest.method).toBe('GET');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.curl).toContain('jokeapi.dev');
      expect(result.stats.totalRequests).toBeGreaterThan(0);
      expect(result.stats.filteredRequests).toBeGreaterThan(0);
      expect(result.stats.processingTime.total).toBeGreaterThan(0);

      // Execute the generated curl
      const exec = await executeCurl(result.curl);
      expect(exec.status).toBe(200);
      expect(exec.body).toHaveProperty('jokes');
      expect(exec.body.jokes.length).toBe(5);

      results.push({
        name: 'JokeAPI (jokes-real.har)',
        passed: true,
        executed: true,
        matchedUrl: result.matchedRequest.url,
        confidence: result.confidence,
        totalEntries: result.stats.totalRequests,
        filteredEntries: result.stats.filteredRequests,
        durationMs: elapsed,
        execStatus: exec.status,
      });
    }, 60_000);

    it('SFGate Weather: analyzeHar() → execute curl → get forecast', async () => {
      const harPath = path.join(fixturesDir, 'sfgate.har');
      if (!fs.existsSync(harPath)) return;

      const buffer = fs.readFileSync(harPath);
      const start = Date.now();
      const result = await service.analyzeHar(buffer, 'Return the API that fetches the weather of San Francisco');
      const elapsed = Date.now() - start;

      expect(result.matchedRequest.url).toContain('forecast7.com');
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      expect(result.curl).toContain('forecast7.com');

      // Execute
      const exec = await executeCurl(result.curl);
      expect(exec.status).toBe(200);
      expect(exec.text.length).toBeGreaterThan(50);

      results.push({
        name: 'SFGate Weather (sfgate.har)',
        passed: true,
        executed: true,
        matchedUrl: result.matchedRequest.url,
        confidence: result.confidence,
        totalEntries: result.stats.totalRequests,
        filteredEntries: result.stats.filteredRequests,
        durationMs: elapsed,
        execStatus: exec.status,
      });
    }, 60_000);

    it('RecipeScal: analyzeHar() → pipeline validation', async () => {
      const harPath = path.join(fixturesDir, 'recipescal.har');
      if (!fs.existsSync(harPath)) return;

      const buffer = fs.readFileSync(harPath);
      const start = Date.now();
      const result = await service.analyzeHar(buffer, 'reverse engineer the API that gives me recipes for a given portion and calorie count');
      const elapsed = Date.now() - start;

      expect(result.matchedRequest.url).toContain('recipescal.com/api/bookapi');
      expect(result.matchedRequest.method).toBe('POST');
      expect(result.curl).toContain('newData');
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);

      results.push({
        name: 'RecipeScal (recipescal.har)',
        passed: true,
        executed: false,
        matchedUrl: result.matchedRequest.url,
        confidence: result.confidence,
        totalEntries: result.stats.totalRequests,
        filteredEntries: result.stats.filteredRequests,
        durationMs: elapsed,
      });
    }, 60_000);
  });

  // ---------------------------------------------------------------------------
  // Section 2: Synthetic HAR files (test various API patterns)
  // ---------------------------------------------------------------------------
  describe('Synthetic HAR files → pipeline validation', () => {
    interface SyntheticCase {
      name: string;
      harFile: string;
      description: string;
      expectedUrlContains: string;
      expectedMethod?: string;
    }

    const syntheticCases: SyntheticCase[] = [
      {
        name: 'GraphQL app',
        harFile: 'graphql-app.har',
        description: 'Find the GraphQL API endpoint',
        expectedUrlContains: 'graphql',
      },
      {
        name: 'E-commerce product search',
        harFile: 'ecommerce.har',
        description: 'Find the product search API',
        expectedUrlContains: 'product',
      },
      {
        name: 'SPA dashboard',
        harFile: 'spa-dashboard.har',
        description: 'Find the dashboard data API',
        expectedUrlContains: 'api',
      },
    ];

    for (const tc of syntheticCases) {
      it(`${tc.name}: analyzeHar() matches expected API`, async () => {
        const harPath = path.join(fixturesDir, tc.harFile);
        if (!fs.existsSync(harPath)) {
          console.log(`  Skipping ${tc.harFile} — not found`);
          return;
        }

        const buffer = fs.readFileSync(harPath);
        const start = Date.now();
        const result = await service.analyzeHar(buffer, tc.description);
        const elapsed = Date.now() - start;

        expect(result.matchedRequest.url.toLowerCase()).toContain(tc.expectedUrlContains);
        if (tc.expectedMethod) {
          expect(result.matchedRequest.method).toBe(tc.expectedMethod);
        }
        expect(result.confidence).toBeGreaterThanOrEqual(0.3);
        expect(result.curl).toBeTruthy();

        results.push({
          name: `${tc.name} (${tc.harFile})`,
          passed: true,
          executed: false,
          matchedUrl: result.matchedRequest.url,
          confidence: result.confidence,
          totalEntries: result.stats.totalRequests,
          filteredEntries: result.stats.filteredRequests,
          durationMs: elapsed,
        });
      }, 60_000);
    }
  });

  // ---------------------------------------------------------------------------
  // Section 3: Playwright-captured HAR files (if available)
  // ---------------------------------------------------------------------------
  describe('Captured browser HARs → pipeline + execution', () => {
    interface CapturedCase {
      name: string;
      filename: string;
      description: string;
      expectedUrlContains: string;
      /** If true, execute the returned curl and verify response */
      canExecute: boolean;
      validateExec?: (body: any, status: number) => void;
    }

    const capturedCases: CapturedCase[] = [
      {
        name: 'Open-Meteo Weather',
        filename: 'open-meteo-weather.har',
        description: 'Find the weather forecast API call',
        expectedUrlContains: 'open-meteo.com',
        canExecute: true,
        validateExec: (body, status) => {
          expect(status).toBe(200);
          expect(body).toBeTruthy();
        },
      },
      {
        name: 'USGS Earthquakes',
        filename: 'usgs-earthquakes.har',
        description: 'Find the earthquake data API that returns GeoJSON',
        expectedUrlContains: 'earthquake.usgs.gov',
        canExecute: true,
        validateExec: (body, status) => {
          expect(status).toBe(200);
        },
      },
      {
        name: 'PokeAPI',
        filename: 'pokeapi-pokemon.har',
        description: 'Find the Pokemon data API call',
        expectedUrlContains: 'pokeapi.co',
        canExecute: true,
        validateExec: (body, status) => {
          expect(status).toBe(200);
        },
      },
      {
        name: 'Hacker News',
        filename: 'hackernews-firebase.har',
        description: 'Find the API that loads the front page stories',
        expectedUrlContains: 'ycombinator',
        canExecute: false,
      },
      {
        name: 'Dog CEO',
        filename: 'dog-ceo-random.har',
        description: 'Find the random dog image API',
        expectedUrlContains: 'dog.ceo',
        canExecute: true,
        validateExec: (body, status) => {
          expect(status).toBe(200);
        },
      },
      {
        name: 'JSONPlaceholder',
        filename: 'jsonplaceholder-todos.har',
        description: 'Find the REST API call that fetches todos or posts',
        expectedUrlContains: 'jsonplaceholder',
        canExecute: true,
        validateExec: (body, status) => {
          expect(status).toBe(200);
          expect(Array.isArray(body) || typeof body === 'object').toBe(true);
        },
      },
    ];

    for (const tc of capturedCases) {
      it(`${tc.name}: analyzeHar() → match${tc.canExecute ? ' + execute' : ''}`, async () => {
        const harPath = path.join(capturedDir, tc.filename);
        if (!fs.existsSync(harPath)) {
          console.log(`  Skipping ${tc.filename} — run capture-real-hars.ts first`);
          return;
        }

        const buffer = fs.readFileSync(harPath);
        const start = Date.now();
        const result = await service.analyzeHar(buffer, tc.description);
        const elapsed = Date.now() - start;

        // The matched URL should relate to the target API
        expect(result.matchedRequest.url.toLowerCase()).toContain(tc.expectedUrlContains);
        expect(result.confidence).toBeGreaterThanOrEqual(0.3);
        expect(result.curl).toBeTruthy();

        let execStatus: number | undefined;

        // Execute if configured
        if (tc.canExecute) {
          const exec = await executeCurl(result.curl);
          execStatus = exec.status;
          if (tc.validateExec) {
            tc.validateExec(exec.body, exec.status);
          }
        }

        results.push({
          name: `${tc.name} (captured)`,
          passed: true,
          executed: tc.canExecute,
          matchedUrl: result.matchedRequest.url,
          confidence: result.confidence,
          totalEntries: result.stats.totalRequests,
          filteredEntries: result.stats.filteredRequests,
          durationMs: elapsed,
          execStatus,
        });
      }, 90_000);
    }
  });

  // ---------------------------------------------------------------------------
  // Section 4: Pipeline invariant checks
  // ---------------------------------------------------------------------------
  describe('Pipeline invariants', () => {
    it('analyzeHar() returns all required fields with correct types', async () => {
      const harPath = path.join(fixturesDir, 'jokes-real.har');
      if (!fs.existsSync(harPath)) return;

      const buffer = fs.readFileSync(harPath);
      const result = await service.analyzeHar(buffer, 'get jokes');

      // Type checks on AnalysisResult shape
      expect(typeof result.curl).toBe('string');
      expect(result.curl.startsWith('curl')).toBe(true);

      expect(typeof result.matchedRequest.method).toBe('string');
      expect(typeof result.matchedRequest.url).toBe('string');
      expect(typeof result.matchedRequest.status).toBe('number');
      expect(typeof result.matchedRequest.contentType).toBe('string');

      expect(typeof result.confidence).toBe('number');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);

      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);

      expect(Array.isArray(result.topMatches)).toBe(true);
      expect(result.topMatches.length).toBeGreaterThanOrEqual(1);
      for (const m of result.topMatches) {
        expect(typeof m.index).toBe('number');
        expect(typeof m.confidence).toBe('number');
        expect(typeof m.reason).toBe('string');
        expect(typeof m.method).toBe('string');
        expect(typeof m.url).toBe('string');
      }

      expect(typeof result.stats.totalRequests).toBe('number');
      expect(typeof result.stats.filteredRequests).toBe('number');
      expect(typeof result.stats.uniqueRequests).toBe('number');
      expect(typeof result.stats.promptTokens).toBe('number');
      expect(typeof result.stats.completionTokens).toBe('number');
      expect(typeof result.stats.cost).toBe('number');
      expect(typeof result.stats.processingTime.total).toBe('number');
      expect(typeof result.stats.processingTime.parsing).toBe('number');
      expect(typeof result.stats.processingTime.llm).toBe('number');

      expect(Array.isArray(result.allRequests)).toBe(true);
      expect(result.allRequests.length).toBe(result.stats.totalRequests);
    }, 60_000);

    it('analyzeHar() throws on empty/static-only HAR', async () => {
      // Create a HAR with only static assets
      const staticOnlyHar = {
        log: {
          version: '1.2',
          creator: { name: 'test', version: '1.0' },
          entries: [
            {
              startedDateTime: '2024-01-01T00:00:00.000Z',
              time: 50,
              request: {
                method: 'GET',
                url: 'https://example.com/styles.css',
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
                headers: [{ name: 'Content-Type', value: 'text/css' }],
                content: { size: 100, mimeType: 'text/css' },
                redirectURL: '',
                headersSize: -1,
                bodySize: 100,
              },
              cache: {},
              timings: { send: 0, wait: 25, receive: 25 },
            },
            {
              startedDateTime: '2024-01-01T00:00:01.000Z',
              time: 30,
              request: {
                method: 'GET',
                url: 'https://example.com/logo.png',
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
                headers: [{ name: 'Content-Type', value: 'image/png' }],
                content: { size: 5000, mimeType: 'image/png' },
                redirectURL: '',
                headersSize: -1,
                bodySize: 5000,
              },
              cache: {},
              timings: { send: 0, wait: 15, receive: 15 },
            },
          ],
        },
      };

      const buffer = Buffer.from(JSON.stringify(staticOnlyHar));
      await expect(service.analyzeHar(buffer, 'find the API')).rejects.toThrow(/No API requests found/);
    });

    it('analyzeHar() rejects invalid JSON', async () => {
      const buffer = Buffer.from('this is not json {{{');
      await expect(service.analyzeHar(buffer, 'find something')).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Summary table
  // ---------------------------------------------------------------------------
  afterAll(() => {
    if (results.length === 0) return;

    console.log('\n');
    console.log('='.repeat(100));
    console.log('  E2E PIPELINE RESULTS');
    console.log('='.repeat(100));

    const passed = results.filter((r) => r.passed).length;
    const executed = results.filter((r) => r.executed).length;
    console.log(`  Total: ${results.length}  |  Passed: ${passed}  |  Executed curl: ${executed}  |  Pass rate: ${((passed / results.length) * 100).toFixed(1)}%`);
    console.log('-'.repeat(100));

    for (const r of results) {
      const status = r.passed ? '[PASS]' : '[FAIL]';
      const exec = r.executed ? ` → HTTP ${r.execStatus}` : '';
      console.log(`  ${status} ${r.name}`);
      console.log(`         URL: ${r.matchedUrl}`);
      console.log(`         Confidence: ${(r.confidence * 100).toFixed(0)}%  |  Entries: ${r.filteredEntries}/${r.totalEntries}  |  Time: ${(r.durationMs / 1000).toFixed(1)}s${exec}`);
    }

    console.log('='.repeat(100));
  });
});
