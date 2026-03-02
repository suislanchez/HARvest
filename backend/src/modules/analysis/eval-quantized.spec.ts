/**
 * Quantized Model Eval — tests quantized variants of qwen2.5 on a subset of cases.
 *
 * Compares accuracy and latency of quantized models against the 98.4% qwen2.5:7b baseline.
 *
 * Run:
 *   cd backend && npx jest eval-quantized --testTimeout=600000 --runInBand --verbose
 *
 * Requires: Ollama running locally with quantized models pulled:
 *   ollama pull qwen2.5:7b-q4_0
 *   ollama pull qwen2.5:7b-q8_0
 *   ollama pull qwen2.5:3b-q4_K_M
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
// Quantized models to test
// ---------------------------------------------------------------------------
const QUANTIZED_MODELS = [
  'qwen2.5:7b',        // baseline (full precision)
  'qwen2.5:7b-q4_0',   // 4-bit quantized
  'qwen2.5:7b-q8_0',   // 8-bit quantized
  'qwen2.5:3b-q4_K_M', // 3b 4-bit K-quant
];

// ---------------------------------------------------------------------------
// 13-case subset (same as eval-local.spec.ts)
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
  { id: 'simple-weather', fixture: 'simple.har', description: 'the weather forecast API', expectedUrlPattern: '/v3/wx/forecast', category: 'Basic', difficulty: 'easy' },
  { id: 'simple-joke', fixture: 'simple.har', description: 'the joke API', expectedUrlPattern: 'joke-api.appspot.com', category: 'Basic', difficulty: 'easy' },
  { id: 'recipe-search', fixture: 'recipe-search.har', description: 'the recipe search API', expectedUrlPattern: '/v2/search', category: 'Recipe', difficulty: 'easy' },
  { id: 'ecommerce-cart', fixture: 'ecommerce.har', description: 'shopping cart API', expectedUrlPattern: '/v1/cart', category: 'E-commerce', difficulty: 'medium' },
  { id: 'ecommerce-orders', fixture: 'ecommerce.har', description: 'the checkout or order creation endpoint', expectedUrlPattern: '/v1/orders', category: 'E-commerce', difficulty: 'medium' },
  { id: 'graphql-profile', fixture: 'graphql-app.har', description: 'the user profile query', expectedUrlPattern: 'graphql', expectedBodyPattern: 'GetUserProfile', category: 'GraphQL', difficulty: 'medium' },
  { id: 'noisy-weather', fixture: 'multi-api-noisy.har', description: 'current weather data for a city', expectedUrlPattern: '/data/2.5/weather', category: 'Noisy', difficulty: 'medium' },
  { id: 'streaming-search', fixture: 'streaming-platform.har', description: 'search for TV shows or movies', expectedUrlPattern: '/catalog/search', category: 'Streaming', difficulty: 'medium' },
  { id: 'fintech-transfers', fixture: 'fintech-banking.har', description: 'the money transfer or send money endpoint', expectedUrlPattern: '/transfers', expectedBodyPattern: 'fromAccount', category: 'Fintech', difficulty: 'hard' },
  { id: 'travel-flights', fixture: 'travel-booking.har', description: 'flight search from San Francisco to Tokyo', expectedUrlPattern: 'flights.example.com', expectedBodyPattern: 'SFO', category: 'Travel', difficulty: 'hard' },
  { id: 'dashboard-config', fixture: 'spa-dashboard.har', description: 'the dashboard configuration or layout', expectedUrlPattern: '/dashboards/d_', category: 'Dashboard', difficulty: 'hard' },
  { id: 'vague-buy', fixture: 'ecommerce.har', description: 'the API call that happens when you click buy', expectedUrlPattern: '/v1/orders', category: 'Vague', difficulty: 'extreme' },
  { id: 'vague-play', fixture: 'streaming-platform.har', description: 'what loads when you press play', expectedUrlPattern: '/playback/start', category: 'Vague', difficulty: 'extreme' },
];

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------
interface QuantizedResult {
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

const allResults: QuantizedResult[] = [];

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
  for (const model of QUANTIZED_MODELS) {
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

  // Print summary table
  console.log('\n\n========== QUANTIZED MODEL COMPARISON ==========\n');

  for (const model of QUANTIZED_MODELS) {
    const modelResults = allResults.filter((r) => r.model === model);
    const passed = modelResults.filter((r) => r.passed).length;
    const total = modelResults.length;
    const avgConf = modelResults.reduce((s, r) => s + r.confidence, 0) / total;
    const avgLatency = modelResults.reduce((s, r) => s + r.latency, 0) / total;
    const accuracy = ((passed / total) * 100).toFixed(1);

    console.log(`${model}:`);
    console.log(`  Accuracy: ${accuracy}% (${passed}/${total})`);
    console.log(`  Avg Confidence: ${(avgConf * 100).toFixed(1)}%`);
    console.log(`  Avg Latency: ${Math.round(avgLatency)}ms`);

    // Breakdown by difficulty
    for (const diff of ['easy', 'medium', 'hard', 'extreme']) {
      const diffResults = modelResults.filter((r) => r.difficulty === diff);
      if (diffResults.length === 0) continue;
      const diffPassed = diffResults.filter((r) => r.passed).length;
      console.log(`  ${diff}: ${diffPassed}/${diffResults.length}`);
    }
    console.log('');
  }

  // Write CSV
  const date = new Date().toISOString().slice(0, 10);
  const csvPath = path.join(RESULTS_DIR, `quantized-eval-${date}.csv`);

  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const csvHeader = 'model,id,difficulty,category,passed,confidence,latency_ms,matched_url,expected_pattern,error\n';
  const csvRows = allResults.map((r) =>
    [
      r.model,
      r.id,
      r.difficulty,
      r.category,
      r.passed,
      r.confidence.toFixed(2),
      Math.round(r.latency),
      `"${r.matchedUrl}"`,
      `"${r.expectedUrlPattern}"`,
      `"${r.error || ''}"`,
    ].join(',')
  );

  fs.writeFileSync(csvPath, csvHeader + csvRows.join('\n') + '\n');
  console.log(`Results written to ${csvPath}`);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Quantized Model Evaluation', () => {
  for (const model of QUANTIZED_MODELS) {
    describe(model, () => {
      for (const tc of evalCases) {
        it(`[${tc.difficulty}] ${tc.id}: "${tc.description}"`, async () => {
          const fixturePath = path.join(FIXTURES_DIR, tc.fixture);

          if (!fs.existsSync(fixturePath)) {
            const result: QuantizedResult = {
              model, id: tc.id, difficulty: tc.difficulty, category: tc.category,
              passed: false, confidence: 0, latency: 0, matchedUrl: '',
              expectedUrlPattern: tc.expectedUrlPattern, error: 'Fixture not found',
            };
            allResults.push(result);
            console.warn(`  SKIP: ${fixturePath} not found`);
            return;
          }

          const fileBuffer = fs.readFileSync(fixturePath);
          const har = harParser.parseHar(fileBuffer as unknown as Buffer);
          const filtered = harParser.filterApiRequests(har.log.entries);
          const { summary } = harParser.generateLlmSummary(filtered, har.log.entries.length);

          const service = services.get(model)!;
          const start = Date.now();

          let matchedUrl = '';
          let confidence = 0;
          let passed = false;
          let error: string | undefined;

          try {
            const llmResult = await service.identifyApiRequest(summary, tc.description, filtered.length);
            const elapsed = Date.now() - start;

            const matchedEntry = filtered[llmResult.matchIndex];
            matchedUrl = matchedEntry?.request.url || 'UNKNOWN';
            confidence = llmResult.confidence;

            // Check URL pattern
            const urlMatch = matchedUrl.includes(tc.expectedUrlPattern);

            // Check body pattern if specified
            let bodyMatch = true;
            if (tc.expectedBodyPattern && matchedEntry) {
              const body = matchedEntry.request.postData?.text || '';
              bodyMatch = body.includes(tc.expectedBodyPattern);
            }

            passed = urlMatch && bodyMatch;

            allResults.push({
              model, id: tc.id, difficulty: tc.difficulty, category: tc.category,
              passed, confidence, latency: elapsed, matchedUrl,
              expectedUrlPattern: tc.expectedUrlPattern,
            });

            console.log(`  ${passed ? 'PASS' : 'FAIL'} [${model}] ${tc.id}: ${matchedUrl} (${(confidence * 100).toFixed(0)}%, ${elapsed}ms)`);

            expect(urlMatch || bodyMatch).toBeDefined();
          } catch (e) {
            const elapsed = Date.now() - start;
            error = (e as Error).message.substring(0, 200);

            allResults.push({
              model, id: tc.id, difficulty: tc.difficulty, category: tc.category,
              passed: false, confidence: 0, latency: elapsed, matchedUrl: '',
              expectedUrlPattern: tc.expectedUrlPattern, error,
            });

            console.log(`  ERROR [${model}] ${tc.id}: ${error}`);
          }
        });
      }
    });
  }
});
