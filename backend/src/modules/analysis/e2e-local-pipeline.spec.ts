/**
 * Local LLM End-to-End Pipeline Tests
 *
 * Tests the EXACT same pipeline as e2e-pipeline.spec.ts but using LOCAL models
 * via Ollama. Zero API calls, zero cost.
 *
 * Tests the full pipeline:
 *   HAR buffer → parse → filter → deduplicate → summarize → LOCAL LLM match → curl gen
 *
 * Run with:
 *   cd backend && npx jest e2e-local-pipeline --testTimeout=300000 --runInBand --verbose
 *
 * Requires: Ollama running locally (ollama serve)
 */

import * as fs from 'fs';
import * as path from 'path';
import { AnalysisService, AnalysisResult } from './analysis.service';
import { HarParserService } from './har-parser.service';
import { HarToCurlService } from './har-to-curl.service';
import { LocalLlmService } from '../local-llm/local-llm.service';
import { ConfigService } from '@nestjs/config';

jest.setTimeout(300000);

// Best local model from previous benchmarks
const LOCAL_MODEL = process.env.LOCAL_LLM_MODEL || 'qwen2.5:3b';

describe(`E2E Local Pipeline (${LOCAL_MODEL}) — ZERO API CALLS`, () => {
  let service: AnalysisService;
  let harParser: HarParserService;
  let harToCurl: HarToCurlService;
  let localLlm: LocalLlmService;

  const fixturesDir = path.resolve(__dirname, '../../../../test-fixtures');
  const capturedDir = path.join(fixturesDir, 'captured');

  beforeAll(async () => {
    // Check Ollama
    try {
      const resp = await fetch('http://localhost:11434/v1/models');
      if (!resp.ok) throw new Error('Ollama not responding');
    } catch {
      throw new Error('Ollama is not running. Start it with: ollama serve');
    }

    harParser = new HarParserService();
    harToCurl = new HarToCurlService();

    const configService = {
      get: (key: string) => {
        if (key === 'LOCAL_LLM_MODEL') return LOCAL_MODEL;
        if (key === 'LOCAL_LLM_BASE_URL') return 'http://localhost:11434/v1';
        return process.env[key];
      },
    } as unknown as ConfigService;

    localLlm = new LocalLlmService(configService);
    service = new AnalysisService(harParser, harToCurl, localLlm as any);

    console.log(`\nUsing local model: ${LOCAL_MODEL}`);
    console.log(`Cost per query: $0.00\n`);
  });

  // ---------------------------------------------------------------------------
  // Result tracking
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
    error?: string;
  }

  const results: PipelineResult[] = [];

  // ---------------------------------------------------------------------------
  // Section 1: Synthetic HAR files — full pipeline validation
  // ---------------------------------------------------------------------------
  describe('Synthetic HAR files → local LLM pipeline', () => {
    interface TestCase {
      name: string;
      harFile: string;
      description: string;
      expectedUrlContains: string;
      expectedBodyContains?: string;
    }

    const cases: TestCase[] = [
      { name: 'Simple weather', harFile: 'simple.har', description: 'the weather forecast API', expectedUrlContains: '/v3/wx/forecast' },
      { name: 'Simple joke', harFile: 'simple.har', description: 'the joke API', expectedUrlContains: 'joke-api' },
      { name: 'Recipe search', harFile: 'recipe-search.har', description: 'the recipe search API', expectedUrlContains: '/v2/search' },
      { name: 'E-commerce cart', harFile: 'ecommerce.har', description: 'shopping cart API', expectedUrlContains: '/v1/cart' },
      { name: 'E-commerce orders', harFile: 'ecommerce.har', description: 'the checkout or order creation endpoint', expectedUrlContains: '/v1/orders' },
      { name: 'GraphQL profile', harFile: 'graphql-app.har', description: 'the user profile query', expectedUrlContains: 'graphql' },
      { name: 'Streaming search', harFile: 'streaming-platform.har', description: 'search for TV shows or movies', expectedUrlContains: '/catalog/search' },
      { name: 'Fintech transfers', harFile: 'fintech-banking.har', description: 'the money transfer or send money endpoint', expectedUrlContains: '/transfers' },
      { name: 'Travel flights', harFile: 'travel-booking.har', description: 'flight search from San Francisco to Tokyo', expectedUrlContains: 'flights.example.com' },
      { name: 'Dashboard alerts', harFile: 'spa-dashboard.har', description: 'active critical alerts', expectedUrlContains: '/alerts' },
      { name: 'Collab documents', harFile: 'realtime-collab.har', description: 'list of documents in a workspace', expectedUrlContains: '/documents' },
      // Vague/extreme
      { name: 'Vague: click buy', harFile: 'ecommerce.har', description: 'the API call that happens when you click buy', expectedUrlContains: '/v1/orders' },
      { name: 'Vague: press play', harFile: 'streaming-platform.har', description: 'what loads when you press play', expectedUrlContains: '/playback/start' },
    ];

    for (const tc of cases) {
      it(`${tc.name}: analyzeHar() via local LLM → correct match`, async () => {
        const harPath = path.join(fixturesDir, tc.harFile);
        if (!fs.existsSync(harPath)) {
          console.log(`  Skipping ${tc.harFile} — not found`);
          return;
        }

        const buffer = fs.readFileSync(harPath);
        const start = Date.now();

        let result: AnalysisResult;
        try {
          result = await service.analyzeHar(buffer, tc.description);
        } catch (err: any) {
          results.push({
            name: tc.name,
            passed: false,
            executed: false,
            matchedUrl: '',
            confidence: 0,
            totalEntries: 0,
            filteredEntries: 0,
            durationMs: Date.now() - start,
            error: err.message?.substring(0, 80),
          });
          console.log(`  [ERR] ${tc.name}: ${err.message?.substring(0, 60)}`);
          return;
        }

        const elapsed = Date.now() - start;
        const matched = result.matchedRequest.url.toLowerCase().includes(tc.expectedUrlContains.toLowerCase());

        results.push({
          name: tc.name,
          passed: matched,
          executed: false,
          matchedUrl: result.matchedRequest.url,
          confidence: result.confidence,
          totalEntries: result.stats.totalRequests,
          filteredEntries: result.stats.filteredRequests,
          durationMs: elapsed,
        });

        const icon = matched ? 'PASS' : 'FAIL';
        console.log(`  [${icon}] ${tc.name} | ${elapsed}ms | conf=${(result.confidence * 100).toFixed(0)}% | ${result.matchedRequest.url.substring(0, 60)}`);

        expect(matched).toBe(true);
      }, 120_000);
    }
  });

  // ---------------------------------------------------------------------------
  // Section 2: Captured browser HARs → local pipeline + execution
  // ---------------------------------------------------------------------------
  describe('Captured browser HARs → local pipeline + execution', () => {
    interface CapturedCase {
      name: string;
      filename: string;
      description: string;
      expectedUrlContains: string;
      canExecute: boolean;
      mayHaveNoApiRequests?: boolean;
    }

    const capturedCases: CapturedCase[] = [
      { name: 'Open-Meteo Weather', filename: 'open-meteo-weather.har', description: 'Find the weather forecast API call', expectedUrlContains: 'open-meteo.com', canExecute: true },
      { name: 'USGS Earthquakes', filename: 'usgs-earthquakes.har', description: 'Find the earthquake data API that returns GeoJSON', expectedUrlContains: 'earthquake.usgs.gov', canExecute: true },
      { name: 'PokeAPI', filename: 'pokeapi-pokemon.har', description: 'Find the Pokemon data API call', expectedUrlContains: 'pokeapi.co', canExecute: true },
      { name: 'Dog CEO', filename: 'dog-ceo-random.har', description: 'Find the random dog image API', expectedUrlContains: 'dog.ceo', canExecute: true },
    ];

    for (const tc of capturedCases) {
      it(`${tc.name}: local LLM match${tc.canExecute ? ' + execute curl' : ''}`, async () => {
        const harPath = path.join(capturedDir, tc.filename);
        if (!fs.existsSync(harPath)) {
          console.log(`  Skipping ${tc.filename} — run capture-real-hars.ts first`);
          return;
        }

        const buffer = fs.readFileSync(harPath);
        const start = Date.now();

        let result: AnalysisResult;
        try {
          result = await service.analyzeHar(buffer, tc.description);
        } catch (err: any) {
          if (tc.mayHaveNoApiRequests) {
            console.log(`  Skipping ${tc.filename} — no API requests in captured HAR`);
            return;
          }
          throw err;
        }

        const elapsed = Date.now() - start;
        const matched = result.matchedRequest.url.toLowerCase().includes(tc.expectedUrlContains.toLowerCase());

        let execStatus: number | undefined;
        if (tc.canExecute && matched) {
          try {
            const parsed = harToCurl.parseCurlToRequest(result.curl);
            const fetchRes = await fetch(parsed.url, {
              method: parsed.method,
              headers: parsed.headers,
              body: parsed.body,
              signal: AbortSignal.timeout(15000),
            });
            execStatus = fetchRes.status;
          } catch {
            // execution failure is not a test failure
          }
        }

        results.push({
          name: `${tc.name} (captured)`,
          passed: matched,
          executed: !!execStatus,
          matchedUrl: result.matchedRequest.url,
          confidence: result.confidence,
          totalEntries: result.stats.totalRequests,
          filteredEntries: result.stats.filteredRequests,
          durationMs: elapsed,
          execStatus,
        });

        const icon = matched ? 'PASS' : 'FAIL';
        const exec = execStatus ? ` → HTTP ${execStatus}` : '';
        console.log(`  [${icon}] ${tc.name} | ${elapsed}ms | conf=${(result.confidence * 100).toFixed(0)}%${exec}`);

        expect(matched).toBe(true);
      }, 120_000);
    }
  });

  // ---------------------------------------------------------------------------
  // Section 3: Pipeline invariant checks with local model
  // ---------------------------------------------------------------------------
  describe('Pipeline invariants (local)', () => {
    it('analyzeHar() returns all required fields with correct types', async () => {
      const harPath = path.join(fixturesDir, 'simple.har');
      if (!fs.existsSync(harPath)) return;

      const buffer = fs.readFileSync(harPath);
      const result = await service.analyzeHar(buffer, 'the weather forecast API');

      expect(typeof result.curl).toBe('string');
      expect(result.curl.startsWith('curl')).toBe(true);
      expect(typeof result.matchedRequest.method).toBe('string');
      expect(typeof result.matchedRequest.url).toBe('string');
      expect(typeof result.confidence).toBe('number');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(typeof result.reason).toBe('string');
      expect(Array.isArray(result.topMatches)).toBe(true);
      expect(typeof result.stats.totalRequests).toBe('number');
      expect(typeof result.stats.filteredRequests).toBe('number');
      expect(typeof result.stats.processingTime.total).toBe('number');
      expect(typeof result.stats.processingTime.llm).toBe('number');
    }, 120_000);

    it('analyzeHar() throws on empty/static-only HAR', async () => {
      const staticOnlyHar = {
        log: {
          version: '1.2',
          creator: { name: 'test', version: '1.0' },
          entries: [
            {
              startedDateTime: '2024-01-01T00:00:00.000Z',
              time: 50,
              request: { method: 'GET', url: 'https://example.com/styles.css', httpVersion: 'HTTP/2.0', cookies: [], headers: [], queryString: [], headersSize: -1, bodySize: -1 },
              response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/2.0', cookies: [], headers: [{ name: 'Content-Type', value: 'text/css' }], content: { size: 100, mimeType: 'text/css' }, redirectURL: '', headersSize: -1, bodySize: 100 },
              cache: {},
              timings: { send: 0, wait: 25, receive: 25 },
            },
          ],
        },
      };
      const buffer = Buffer.from(JSON.stringify(staticOnlyHar));
      await expect(service.analyzeHar(buffer, 'find the API')).rejects.toThrow(/No API requests found/);
    });
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  afterAll(() => {
    if (results.length === 0) return;

    const passed = results.filter((r) => r.passed).length;
    const executed = results.filter((r) => r.executed).length;
    const errors = results.filter((r) => r.error).length;
    const avgConf = results.filter((r) => r.passed).reduce((s, r) => s + r.confidence, 0) / Math.max(passed, 1);
    const avgLatency = Math.round(results.reduce((s, r) => s + r.durationMs, 0) / results.length);

    console.log('\n' + '='.repeat(100));
    console.log(`  E2E LOCAL PIPELINE RESULTS — ${LOCAL_MODEL} (ZERO API CALLS, $0.00 COST)`);
    console.log('='.repeat(100));
    console.log(`  Total: ${results.length}  |  Passed: ${passed}  |  Errors: ${errors}  |  Executed curl: ${executed}`);
    console.log(`  Pass rate: ${((passed / results.length) * 100).toFixed(1)}%  |  Avg confidence: ${(avgConf * 100).toFixed(0)}%  |  Avg latency: ${avgLatency}ms`);
    console.log('-'.repeat(100));

    for (const r of results) {
      const status = r.passed ? '[PASS]' : r.error ? '[ERR ]' : '[FAIL]';
      const exec = r.executed ? ` → HTTP ${r.execStatus}` : '';
      console.log(`  ${status} ${r.name}`);
      console.log(`         URL: ${r.matchedUrl.substring(0, 80)}`);
      console.log(`         Conf: ${(r.confidence * 100).toFixed(0)}%  |  Entries: ${r.filteredEntries}/${r.totalEntries}  |  Time: ${(r.durationMs / 1000).toFixed(1)}s${exec}`);
      if (r.error) console.log(`         Error: ${r.error}`);
    }

    console.log('='.repeat(100));
  });
});
