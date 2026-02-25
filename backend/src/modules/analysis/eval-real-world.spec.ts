/**
 * Real-world evaluation tests using the exact HAR files and prompts
 * from the take-home assignment specification.
 *
 * These test the FULL pipeline with real OpenAI API calls:
 *   HAR file → parse → filter → summarize → LLM match → curl generation
 *
 * Run with:
 *   cd backend && npx jest eval-real-world --testTimeout=120000 --verbose
 */

import * as fs from 'fs';
import * as path from 'path';
import { AnalysisService } from './analysis.service';
import { HarParserService } from './har-parser.service';
import { HarToCurlService } from './har-to-curl.service';
import { OpenaiService } from '../openai/openai.service';
import { ConfigService } from '@nestjs/config';

// Skip entire suite if no API key
const apiKey = process.env.OPENAI_API_KEY;
const describeIf = apiKey ? describe : describe.skip;

describeIf('Real-World Eval (assignment test cases)', () => {
  let service: AnalysisService;
  let harParser: HarParserService;
  let harToCurl: HarToCurlService;
  let openai: OpenaiService;

  const fixturesDir = path.resolve(__dirname, '../../../../test-fixtures');

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

  interface TestCase {
    name: string;
    harFile: string;
    description: string;
    expectedUrl: string;
    expectedMethod?: string;
    expectedBodyContains?: string;
  }

  const testCases: TestCase[] = [
    {
      name: 'SFGate Weather — "Return the API that fetches the weather of San Francisco"',
      harFile: 'sfgate.har',
      description: 'Return the API that fetches the weather of San Francisco.',
      expectedUrl: 'https://forecast7.com/en/37d77n122d42/san-francisco/',
      expectedMethod: 'GET',
    },
    {
      name: 'RecipeScal — "reverse engineer the API that gives me recipes for a given portion and calorie count"',
      harFile: 'recipescal.har',
      description: 'Can you reverse engineer the API that gives me recipes for a given portion and calorie count?',
      expectedUrl: 'https://recipescal.com/api/bookapi',
      expectedMethod: 'POST',
      expectedBodyContains: 'newData',
    },
    {
      name: 'JokeAPI — "give me a curl command to get 5 jokes via API"',
      harFile: 'jokes-real.har',
      description: 'Can you give me a curl command to get 5 jokes via API?',
      expectedUrl: 'https://v2.jokeapi.dev/joke/Any?amount=5',
      expectedMethod: 'GET',
    },
  ];

  // Check if the large jokes HAR exists
  const largeJokesPath = path.join(fixturesDir, 'jokes-large.har');
  if (fs.existsSync(largeJokesPath)) {
    testCases.push({
      name: 'JokeAPI (LARGE/91MB) — "give me a curl command to get 5 jokes via API"',
      harFile: 'jokes-large.har',
      description: 'Can you give me a curl command to get 5 jokes via API?',
      expectedUrl: 'https://v2.jokeapi.dev/joke/Any?amount=5',
      expectedMethod: 'GET',
    });
  }

  const results: Array<{
    name: string;
    passed: boolean;
    matchedUrl: string;
    expectedUrl: string;
    confidence: number;
    totalEntries: number;
    filteredEntries: number;
    promptTokens: number;
    durationMs: number;
    curlPreview: string;
  }> = [];

  for (const tc of testCases) {
    it(tc.name, async () => {
      const harPath = path.join(fixturesDir, tc.harFile);
      expect(fs.existsSync(harPath)).toBe(true);

      const buffer = fs.readFileSync(harPath);
      const start = Date.now();
      const result = await service.analyzeHar(buffer, tc.description);
      const elapsed = Date.now() - start;

      // Core assertion: did it find the right URL?
      const urlMatch = result.matchedRequest.url.startsWith(tc.expectedUrl);

      // Secondary: correct method?
      if (tc.expectedMethod) {
        expect(result.matchedRequest.method).toBe(tc.expectedMethod);
      }

      // Secondary: body content check?
      if (tc.expectedBodyContains) {
        expect(result.curl).toContain(tc.expectedBodyContains);
      }

      // The curl should contain the expected URL
      expect(result.curl).toContain(tc.expectedUrl);

      // Log result details
      results.push({
        name: tc.name,
        passed: urlMatch,
        matchedUrl: result.matchedRequest.url,
        expectedUrl: tc.expectedUrl,
        confidence: result.confidence,
        totalEntries: result.stats.totalRequests,
        filteredEntries: result.stats.filteredRequests,
        promptTokens: result.stats.promptTokens,
        durationMs: elapsed,
        curlPreview: result.curl.substring(0, 200) + (result.curl.length > 200 ? '...' : ''),
      });

      expect(urlMatch).toBe(true);
    }, 120_000);
  }

  // -------------------------------------------------------------------------
  // Curl execution verification — prove the generated curl actually works
  // Uses JokeAPI (public, no auth, stable) as the smoke test target
  // -------------------------------------------------------------------------
  it('EXECUTION: generated JokeAPI curl returns real jokes when executed', async () => {
    const harPath = path.join(fixturesDir, 'jokes-real.har');
    if (!fs.existsSync(harPath)) return;

    const buffer = fs.readFileSync(harPath);
    const result = await service.analyzeHar(buffer, 'Can you give me a curl command to get 5 jokes via API?');

    // Parse the generated curl back to request components
    const curlService = new HarToCurlService();
    const parsed = curlService.parseCurlToRequest(result.curl);

    expect(parsed.url).toContain('v2.jokeapi.dev/joke/Any');

    // Actually execute the HTTP request
    const fetchRes = await fetch(parsed.url, {
      method: parsed.method,
      headers: parsed.headers,
      signal: AbortSignal.timeout(15000),
    });

    expect(fetchRes.status).toBe(200);

    const body = await fetchRes.json();

    // Verify we got actual jokes back
    expect(body).toHaveProperty('amount');
    expect(body.amount).toBe(5);
    expect(body).toHaveProperty('jokes');
    expect(body.jokes).toHaveLength(5);
    expect(body.jokes[0]).toHaveProperty('type');

    console.log(`  [EXEC] JokeAPI curl executed successfully → ${fetchRes.status}, got ${body.amount} jokes`);
  }, 30_000);

  it('EXECUTION: generated SFGate weather curl returns real forecast data', async () => {
    const harPath = path.join(fixturesDir, 'sfgate.har');
    if (!fs.existsSync(harPath)) return;

    const buffer = fs.readFileSync(harPath);
    const result = await service.analyzeHar(buffer, 'Return the API that fetches the weather of San Francisco.');

    const curlService = new HarToCurlService();
    const parsed = curlService.parseCurlToRequest(result.curl);

    expect(parsed.url).toContain('forecast7.com');

    const fetchRes = await fetch(parsed.url, {
      method: parsed.method,
      headers: parsed.headers,
      signal: AbortSignal.timeout(15000),
    });

    // forecast7 should return 200 with weather data
    expect(fetchRes.status).toBe(200);
    const body = await fetchRes.text();
    expect(body.length).toBeGreaterThan(100);

    console.log(`  [EXEC] SFGate weather curl executed successfully → ${fetchRes.status}, body ${body.length} chars`);
  }, 30_000);

  afterAll(() => {
    if (results.length === 0) return;

    console.log('\n');
    console.log('='.repeat(90));
    console.log('  REAL-WORLD EVAL RESULTS');
    console.log('='.repeat(90));

    const passed = results.filter((r) => r.passed).length;
    console.log(`  Total: ${results.length}  |  Passed: ${passed}  |  Failed: ${results.length - passed}  |  Pass rate: ${((passed / results.length) * 100).toFixed(1)}%`);
    console.log('-'.repeat(90));

    for (const r of results) {
      const status = r.passed ? '[PASS]' : '[FAIL]';
      console.log(`  ${status} ${r.name}`);
      console.log(`         URL: ${r.matchedUrl}`);
      console.log(`         Confidence: ${(r.confidence * 100).toFixed(0)}%`);
      console.log(`         Entries: ${r.filteredEntries} filtered from ${r.totalEntries} total`);
      console.log(`         Tokens: ${r.promptTokens} | Time: ${(r.durationMs / 1000).toFixed(1)}s`);
      console.log(`         Curl: ${r.curlPreview}`);
      console.log('');
    }

    console.log('='.repeat(90));
  });
});
