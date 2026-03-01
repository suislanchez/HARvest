/**
 * Local LLM Eval — runs the benchmark on Ollama models with ZERO API calls.
 *
 * Tests multiple local models head-to-head on the same cases.
 *
 * Run:
 *   cd backend && npx jest eval-local --testTimeout=600000 --runInBand --verbose
 *
 * Requires: Ollama running locally (ollama serve)
 * Models tested: llama3.2:1b, llama3.2:3b, qwen2.5:3b, phi4-mini
 */

import * as path from 'path';
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
import { HarParserService } from './har-parser.service';
import { LocalLlmService } from '../local-llm/local-llm.service';
import type { Entry } from 'har-format';

// ---------------------------------------------------------------------------
// Load environment variables
// ---------------------------------------------------------------------------
function loadEnv(): void {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '..', '.env'),
    path.resolve(__dirname, '..', '..', '..', '..', '.env'),
    path.resolve(__dirname, '..', '..', '..', '.env'),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.substring(0, eqIndex).trim();
        const value = trimmed.substring(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnv();

const FIXTURES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'test-fixtures');
const RESULTS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'benchmark', 'results');

// ---------------------------------------------------------------------------
// Models to test
// ---------------------------------------------------------------------------
const LOCAL_MODELS = [
  'llama3.2:1b',
  'llama3.2:3b',
  'qwen2.5:3b',
  'phi4-mini',
];

// ---------------------------------------------------------------------------
// Test cases — representative subset (keeps total runtime reasonable)
// ---------------------------------------------------------------------------
interface EvalCase {
  id: string;
  fixture: string;
  description: string;
  expectedUrlPattern: string;
  expectedBodyPattern?: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'extreme';
}

const evalCases: EvalCase[] = [
  // Easy
  { id: 'simple-weather', fixture: 'simple.har', description: 'the weather forecast API', expectedUrlPattern: '/v3/wx/forecast', category: 'Basic', difficulty: 'easy' },
  { id: 'simple-joke', fixture: 'simple.har', description: 'the joke API', expectedUrlPattern: 'joke-api.appspot.com', category: 'Basic', difficulty: 'easy' },
  { id: 'recipe-search', fixture: 'recipe-search.har', description: 'the recipe search API', expectedUrlPattern: '/v2/search', category: 'Recipe', difficulty: 'easy' },
  // Medium
  { id: 'ecommerce-cart', fixture: 'ecommerce.har', description: 'shopping cart API', expectedUrlPattern: '/v1/cart', category: 'E-commerce', difficulty: 'medium' },
  { id: 'ecommerce-orders', fixture: 'ecommerce.har', description: 'the checkout or order creation endpoint', expectedUrlPattern: '/v1/orders', category: 'E-commerce', difficulty: 'medium' },
  { id: 'graphql-profile', fixture: 'graphql-app.har', description: 'the user profile query', expectedUrlPattern: 'graphql', expectedBodyPattern: 'GetUserProfile', category: 'GraphQL', difficulty: 'medium' },
  { id: 'noisy-weather', fixture: 'multi-api-noisy.har', description: 'current weather data for a city', expectedUrlPattern: '/data/2.5/weather', category: 'Noisy', difficulty: 'medium' },
  { id: 'streaming-search', fixture: 'streaming-platform.har', description: 'search for TV shows or movies', expectedUrlPattern: '/catalog/search', category: 'Streaming', difficulty: 'medium' },
  // Hard
  { id: 'fintech-transfers', fixture: 'fintech-banking.har', description: 'the money transfer or send money endpoint', expectedUrlPattern: '/transfers', expectedBodyPattern: 'fromAccount', category: 'Fintech', difficulty: 'hard' },
  { id: 'travel-flights', fixture: 'travel-booking.har', description: 'flight search from San Francisco to Tokyo', expectedUrlPattern: 'flights.example.com', expectedBodyPattern: 'SFO', category: 'Travel', difficulty: 'hard' },
  { id: 'dashboard-config', fixture: 'spa-dashboard.har', description: 'the dashboard configuration or layout', expectedUrlPattern: '/dashboards/d_', category: 'Dashboard', difficulty: 'hard' },
  // Extreme
  { id: 'vague-buy', fixture: 'ecommerce.har', description: 'the API call that happens when you click buy', expectedUrlPattern: '/v1/orders', category: 'Vague', difficulty: 'extreme' },
  { id: 'vague-play', fixture: 'streaming-platform.har', description: 'what loads when you press play', expectedUrlPattern: '/playback/start', category: 'Vague', difficulty: 'extreme' },
];

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------
interface LocalResult {
  model: string;
  id: string;
  difficulty: string;
  category: string;
  passed: boolean;
  confidence: number;
  latency: number;
  matchedUrl: string;
  expectedUrlPattern: string;
  error?: string;
}

const allResults: LocalResult[] = [];

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
let harParser: HarParserService;
const services = new Map<string, LocalLlmService>();

jest.setTimeout(600000);

beforeAll(async () => {
  harParser = new HarParserService();

  // Check Ollama is running
  try {
    const resp = await fetch('http://localhost:11434/v1/models');
    if (!resp.ok) throw new Error('Ollama not responding');
  } catch {
    throw new Error('Ollama is not running. Start it with: ollama serve');
  }

  // Create a service instance per model
  for (const model of LOCAL_MODELS) {
    const configService = {
      get: (key: string) => {
        if (key === 'LOCAL_LLM_MODEL') return model;
        if (key === 'LOCAL_LLM_BASE_URL') return 'http://localhost:11434/v1';
        return process.env[key];
      },
    } as unknown as ConfigService;
    services.set(model, new LocalLlmService(configService));
  }
});

afterAll(() => {
  if (allResults.length === 0) return;

  // Write CSV
  const timestamp = new Date().toISOString().split('T')[0];
  const csvPath = path.join(RESULTS_DIR, `local-eval-${timestamp}.csv`);
  const headers = ['model', 'testId', 'difficulty', 'category', 'passed', 'confidence', 'latency', 'matchedUrl', 'error'];
  const csvLines = [headers.join(',')];
  for (const r of allResults) {
    csvLines.push([
      r.model, r.id, r.difficulty, r.category,
      r.passed, r.confidence.toFixed(3), r.latency,
      `"${r.matchedUrl.substring(0, 80)}"`,
      r.error ? `"${r.error.substring(0, 60)}"` : '',
    ].join(','));
  }
  fs.writeFileSync(csvPath, csvLines.join('\n') + '\n');
  console.log(`\nCSV written to: ${csvPath}`);

  // Summary table
  console.log('\n' + '='.repeat(100));
  console.log('  LOCAL LLM BENCHMARK — NO API CALLS, ZERO COST');
  console.log('='.repeat(100));

  for (const model of LOCAL_MODELS) {
    const results = allResults.filter((r) => r.model === model);
    const passed = results.filter((r) => r.passed).length;
    const errors = results.filter((r) => r.error).length;
    const validResults = results.filter((r) => !r.error);
    const avgConf = validResults.length > 0
      ? (validResults.reduce((s, r) => s + r.confidence, 0) / validResults.length * 100).toFixed(1)
      : '0';
    const avgLatency = validResults.length > 0
      ? Math.round(validResults.reduce((s, r) => s + r.latency, 0) / validResults.length)
      : 0;

    console.log(`\n  ${model}`);
    console.log(`    Accuracy: ${passed}/${results.length} (${((passed / results.length) * 100).toFixed(1)}%)`);
    console.log(`    Avg Confidence: ${avgConf}%`);
    console.log(`    Avg Latency: ${avgLatency}ms`);
    console.log(`    Errors: ${errors}`);
    console.log(`    Cost: $0.00 (local)`);

    // By difficulty
    for (const diff of ['easy', 'medium', 'hard', 'extreme']) {
      const diffCases = results.filter((r) => r.difficulty === diff);
      if (diffCases.length === 0) continue;
      const p = diffCases.filter((r) => r.passed).length;
      console.log(`      ${diff.padEnd(10)} ${p}/${diffCases.length} passed`);
    }
  }

  // Comparison table
  console.log('\n' + '-'.repeat(100));
  console.log('  HEAD-TO-HEAD COMPARISON');
  console.log('-'.repeat(100));
  console.log('  ' + 'Model'.padEnd(20) + 'Accuracy'.padEnd(12) + 'Avg Conf'.padEnd(12) + 'Avg Latency'.padEnd(14) + 'Errors'.padEnd(10) + 'Cost');
  console.log('  ' + '-'.repeat(76));
  for (const model of LOCAL_MODELS) {
    const results = allResults.filter((r) => r.model === model);
    const passed = results.filter((r) => r.passed).length;
    const validResults = results.filter((r) => !r.error);
    const errors = results.filter((r) => r.error).length;
    const acc = ((passed / results.length) * 100).toFixed(1) + '%';
    const avgConf = validResults.length > 0
      ? (validResults.reduce((s, r) => s + r.confidence, 0) / validResults.length * 100).toFixed(1) + '%'
      : 'N/A';
    const avgLat = validResults.length > 0
      ? Math.round(validResults.reduce((s, r) => s + r.latency, 0) / validResults.length) + 'ms'
      : 'N/A';
    console.log('  ' + model.padEnd(20) + acc.padEnd(12) + avgConf.padEnd(12) + avgLat.padEnd(14) + String(errors).padEnd(10) + '$0.00');
  }
  console.log('\n' + '='.repeat(100));
});

// ---------------------------------------------------------------------------
// Fixture cache
// ---------------------------------------------------------------------------
const fixtureCache = new Map<string, { allEntries: Entry[]; filtered: Entry[]; llmSummary: string; uniqueCount: number }>();

function getFixtureData(fixture: string) {
  if (fixtureCache.has(fixture)) return fixtureCache.get(fixture)!;

  const fixturePath = path.join(FIXTURES_DIR, fixture);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Fixture not found: ${fixturePath}`);
  }

  const fileBuffer = fs.readFileSync(fixturePath);
  const har = harParser.parseHar(fileBuffer as unknown as Buffer);
  const allEntries = har.log.entries;
  const filtered = harParser.filterApiRequests(allEntries);
  const { summary: llmSummary, uniqueCount } = harParser.generateLlmSummary(filtered, allEntries.length);

  const data = { allEntries, filtered, llmSummary, uniqueCount };
  fixtureCache.set(fixture, data);
  return data;
}

// ---------------------------------------------------------------------------
// Tests — one describe block per model
// ---------------------------------------------------------------------------
for (const model of LOCAL_MODELS) {
  describe(`Local: ${model}`, () => {
    test.each(evalCases)(
      '$id ($difficulty)',
      async (testCase: EvalCase) => {
        const service = services.get(model)!;
        const { allEntries, filtered, llmSummary, uniqueCount } = getFixtureData(testCase.fixture);

        let result: LocalResult;
        const start = Date.now();

        try {
          const llmResult = await service.identifyApiRequest(
            llmSummary,
            testCase.description,
            filtered.length,
          );
          const latency = Date.now() - start;

          const matchedEntry = filtered[llmResult.matchIndex];
          const matchedUrl = matchedEntry?.request.url || '';
          const matchedBody = matchedEntry?.request.postData?.text || '';

          const urlMatched = matchedUrl.includes(testCase.expectedUrlPattern);
          const bodyMatched = testCase.expectedBodyPattern
            ? matchedBody.includes(testCase.expectedBodyPattern)
            : true;
          const passed = urlMatched && bodyMatched;

          result = {
            model,
            id: testCase.id,
            difficulty: testCase.difficulty,
            category: testCase.category,
            passed,
            confidence: llmResult.confidence,
            latency,
            matchedUrl,
            expectedUrlPattern: testCase.expectedUrlPattern,
          };
        } catch (err: any) {
          const latency = Date.now() - start;
          result = {
            model,
            id: testCase.id,
            difficulty: testCase.difficulty,
            category: testCase.category,
            passed: false,
            confidence: 0,
            latency,
            matchedUrl: '',
            expectedUrlPattern: testCase.expectedUrlPattern,
            error: err.message?.substring(0, 100),
          };
        }

        allResults.push(result);

        const icon = result.passed ? 'PASS' : result.error ? 'ERR ' : 'FAIL';
        const errMsg = result.error ? ` | ${result.error.substring(0, 50)}` : '';
        console.log(
          `  [${icon}] ${model.padEnd(16)} | ${testCase.id.padEnd(20)} | ${result.latency}ms | conf=${(result.confidence * 100).toFixed(0)}%${errMsg}`,
        );

        // Don't fail the test — we want all results even if some models fail
        // The summary will show accuracy
      },
    );
  });
}
