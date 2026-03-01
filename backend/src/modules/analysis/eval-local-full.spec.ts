/**
 * Full 63-Case Local LLM Eval — comprehensive benchmark on the BEST local models.
 *
 * Runs the complete eval suite (same 63 cases as eval.spec.ts) on the top-performing
 * local Ollama models. Zero API calls, zero cost.
 *
 * Run:
 *   cd backend && npx jest eval-local-full --testTimeout=900000 --runInBand --verbose
 *
 * Requires: Ollama running locally (ollama serve)
 * Models tested: qwen2.5:3b (champion), qwen2.5:7b, gemma3:4b, phi4-mini
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
// Models to test — top performers only for the full 63-case run
// ---------------------------------------------------------------------------
const LOCAL_MODELS = [
  'qwen2.5:3b',    // Previous champion: 100% on 13 cases
  'qwen2.5:7b',    // Larger Qwen — should be even better
  'gemma3:4b',     // Google Gemma 3 — strong reasoning
  'phi4-mini',     // Microsoft Phi-4 mini — 84.6% on 13 cases
];

// ---------------------------------------------------------------------------
// Full 63-case eval suite (same as eval.spec.ts)
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
  // === Basic ===
  { id: 'basic-weather', fixture: 'simple.har', description: 'the weather forecast API', expectedUrlPattern: '/v3/wx/forecast', category: 'Basic', difficulty: 'easy' },
  { id: 'basic-joke', fixture: 'simple.har', description: 'the joke API', expectedUrlPattern: 'joke-api.appspot.com', category: 'Basic', difficulty: 'easy' },
  { id: 'basic-graphql-alerts', fixture: 'simple.har', description: 'the GraphQL weather alerts query', expectedUrlPattern: 'graphql', expectedBodyPattern: 'GetWeatherAlerts', category: 'Basic', difficulty: 'easy' },

  // === Recipe ===
  { id: 'recipe-search', fixture: 'recipe-search.har', description: 'the recipe search API', expectedUrlPattern: '/v2/search', category: 'Recipe', difficulty: 'easy' },
  { id: 'recipe-detail', fixture: 'recipe-search.har', description: 'recipe detail endpoint', expectedUrlPattern: '/v2/recipes/', category: 'Recipe', difficulty: 'easy' },
  { id: 'recipe-categories', fixture: 'recipe-search.har', description: 'the endpoint that returns food categories', expectedUrlPattern: '/v2/categories', category: 'Recipe', difficulty: 'medium' },

  // === E-commerce ===
  { id: 'ecom-cart', fixture: 'ecommerce.har', description: 'shopping cart API', expectedUrlPattern: '/v1/cart', category: 'E-commerce', difficulty: 'easy' },
  { id: 'ecom-orders', fixture: 'ecommerce.har', description: 'the checkout or order creation endpoint', expectedUrlPattern: '/v1/orders', category: 'E-commerce', difficulty: 'medium' },
  { id: 'ecom-stripe', fixture: 'ecommerce.har', description: 'Stripe payment intent', expectedUrlPattern: 'payment_intents', category: 'E-commerce', difficulty: 'medium' },
  { id: 'ecom-products', fixture: 'ecommerce.har', description: 'API endpoint for listing products by category', expectedUrlPattern: '/v1/products?', category: 'E-commerce', difficulty: 'medium' },
  { id: 'ecom-product-detail', fixture: 'ecommerce.har', description: 'the individual product detail page data', expectedUrlPattern: '/v1/products/8827', category: 'E-commerce', difficulty: 'medium' },
  { id: 'ecom-auth-refresh', fixture: 'ecommerce.har', description: 'the token refresh endpoint', expectedUrlPattern: '/v1/auth/refresh', category: 'E-commerce', difficulty: 'hard' },

  // === GraphQL ===
  { id: 'gql-profile', fixture: 'graphql-app.har', description: 'the user profile query', expectedUrlPattern: 'graphql', expectedBodyPattern: 'GetUserProfile', category: 'GraphQL', difficulty: 'medium' },
  { id: 'gql-feed', fixture: 'graphql-app.har', description: 'the news feed or timeline', expectedUrlPattern: 'graphql', expectedBodyPattern: 'GetFeed', category: 'GraphQL', difficulty: 'medium' },
  { id: 'gql-create-post', fixture: 'graphql-app.har', description: 'the create post mutation', expectedUrlPattern: 'graphql', expectedBodyPattern: 'CreatePost', category: 'GraphQL', difficulty: 'medium' },
  { id: 'gql-followers', fixture: 'graphql-app.har', description: 'the query that loads follower list', expectedUrlPattern: 'graphql', expectedBodyPattern: 'GetFollowers', category: 'GraphQL', difficulty: 'hard' },
  { id: 'gql-notifications', fixture: 'graphql-app.har', description: 'notification data', expectedUrlPattern: 'graphql', expectedBodyPattern: 'GetNotifications', category: 'GraphQL', difficulty: 'hard' },

  // === Noisy ===
  { id: 'noisy-joke', fixture: 'multi-api-noisy.har', description: 'joke API', expectedUrlPattern: 'jokeapi', category: 'Noisy', difficulty: 'medium' },
  { id: 'noisy-weather', fixture: 'multi-api-noisy.har', description: 'current weather data for a city', expectedUrlPattern: '/data/2.5/weather', category: 'Noisy', difficulty: 'medium' },
  { id: 'noisy-newsletter', fixture: 'multi-api-noisy.har', description: 'email newsletter subscription', expectedUrlPattern: '/newsletter/subscribe', category: 'Noisy', difficulty: 'medium' },
  { id: 'noisy-forecast', fixture: 'multi-api-noisy.har', description: 'the 5-day weather forecast, not current conditions', expectedUrlPattern: '/data/2.5/forecast', category: 'Noisy', difficulty: 'hard' },

  // === Dashboard ===
  { id: 'dash-cpu', fixture: 'spa-dashboard.har', description: 'CPU usage metrics time series', expectedUrlPattern: 'metric=cpu', category: 'Dashboard', difficulty: 'hard' },
  { id: 'dash-alerts', fixture: 'spa-dashboard.har', description: 'active critical alerts', expectedUrlPattern: '/alerts', category: 'Dashboard', difficulty: 'medium' },
  { id: 'dash-config', fixture: 'spa-dashboard.har', description: 'the dashboard configuration or layout', expectedUrlPattern: '/dashboards/d_', category: 'Dashboard', difficulty: 'hard' },
  { id: 'dash-widget', fixture: 'spa-dashboard.har', description: 'add a new widget to a dashboard', expectedUrlPattern: '/widgets', expectedBodyPattern: 'timeseries', category: 'Dashboard', difficulty: 'hard' },
  { id: 'dash-user', fixture: 'spa-dashboard.har', description: 'the current user profile endpoint', expectedUrlPattern: '/users/me', category: 'Dashboard', difficulty: 'medium' },
  { id: 'dash-search', fixture: 'spa-dashboard.har', description: 'search for metrics', expectedUrlPattern: '/search', expectedBodyPattern: 'error rate', category: 'Dashboard', difficulty: 'hard' },
  { id: 'dash-servicemap', fixture: 'spa-dashboard.har', description: 'the service map GraphQL query', expectedUrlPattern: 'graphql', expectedBodyPattern: 'GetServiceMap', category: 'Dashboard', difficulty: 'extreme' },
  { id: 'dash-integrations', fixture: 'spa-dashboard.har', description: 'the list of third-party integrations', expectedUrlPattern: '/integrations', category: 'Dashboard', difficulty: 'hard' },

  // === Streaming ===
  { id: 'stream-search', fixture: 'streaming-platform.har', description: 'search for TV shows or movies', expectedUrlPattern: '/catalog/search', category: 'Streaming', difficulty: 'medium' },
  { id: 'stream-title', fixture: 'streaming-platform.har', description: 'details about a specific title including cast and synopsis', expectedUrlPattern: '/catalog/titles/tt_', category: 'Streaming', difficulty: 'medium' },
  { id: 'stream-episodes', fixture: 'streaming-platform.har', description: 'episode list for a season', expectedUrlPattern: '/episodes', category: 'Streaming', difficulty: 'medium' },
  { id: 'stream-playback', fixture: 'streaming-platform.har', description: 'start video playback and get the streaming URL', expectedUrlPattern: '/playback/start', expectedBodyPattern: 'titleId', category: 'Streaming', difficulty: 'hard' },
  { id: 'stream-watchlist', fixture: 'streaming-platform.har', description: 'add something to my watchlist', expectedUrlPattern: '/watchlist', expectedBodyPattern: 'add', category: 'Streaming', difficulty: 'hard' },
  { id: 'stream-recs', fixture: 'streaming-platform.har', description: 'personalized content recommendations', expectedUrlPattern: '/recommendations', category: 'Streaming', difficulty: 'medium' },
  { id: 'stream-manifest', fixture: 'streaming-platform.har', description: 'the video manifest for adaptive streaming', expectedUrlPattern: '.mpd', category: 'Streaming', difficulty: 'extreme' },

  // === Fintech ===
  { id: 'fin-accounts', fixture: 'fintech-banking.har', description: 'list of bank accounts', expectedUrlPattern: '/accounts', category: 'Fintech', difficulty: 'medium' },
  { id: 'fin-transactions', fixture: 'fintech-banking.har', description: 'transaction history', expectedUrlPattern: '/transactions', category: 'Fintech', difficulty: 'medium' },
  { id: 'fin-transfers', fixture: 'fintech-banking.har', description: 'the money transfer or send money endpoint', expectedUrlPattern: '/transfers', expectedBodyPattern: 'fromAccount', category: 'Fintech', difficulty: 'hard' },
  { id: 'fin-balance', fixture: 'fintech-banking.har', description: 'check account balance', expectedUrlPattern: '/balance', category: 'Fintech', difficulty: 'hard' },
  { id: 'fin-schedule', fixture: 'fintech-banking.har', description: 'schedule a recurring bill payment', expectedUrlPattern: '/payments/schedule', expectedBodyPattern: 'recurring', category: 'Fintech', difficulty: 'hard' },
  { id: 'fin-freeze', fixture: 'fintech-banking.har', description: 'freeze or lock a credit card', expectedUrlPattern: '/freeze', expectedBodyPattern: 'lost', category: 'Fintech', difficulty: 'extreme' },
  { id: 'fin-payees', fixture: 'fintech-banking.har', description: 'saved payees or beneficiaries list', expectedUrlPattern: '/payees', category: 'Fintech', difficulty: 'hard' },

  // === Travel ===
  { id: 'travel-flights', fixture: 'travel-booking.har', description: 'flight search from San Francisco to Tokyo', expectedUrlPattern: 'flights.example.com', expectedBodyPattern: 'SFO', category: 'Travel', difficulty: 'medium' },
  { id: 'travel-hotels', fixture: 'travel-booking.har', description: 'hotel search in a city', expectedUrlPattern: 'hotels.example.com', expectedBodyPattern: 'Tokyo', category: 'Travel', difficulty: 'medium' },
  { id: 'travel-rooms', fixture: 'travel-booking.har', description: 'available room types and pricing for a specific hotel', expectedUrlPattern: '/rooms', category: 'Travel', difficulty: 'hard' },
  { id: 'travel-reservation', fixture: 'travel-booking.har', description: 'the final booking or reservation creation', expectedUrlPattern: '/reservations', expectedBodyPattern: 'flightId', category: 'Travel', difficulty: 'hard' },
  { id: 'travel-exchange', fixture: 'travel-booking.har', description: 'currency exchange rates for USD to JPY', expectedUrlPattern: 'exchangerate', category: 'Travel', difficulty: 'hard' },
  { id: 'travel-maps', fixture: 'travel-booking.har', description: 'the Google Maps geocoding request', expectedUrlPattern: 'maps.googleapis.com', category: 'Travel', difficulty: 'medium' },
  { id: 'travel-trips', fixture: 'travel-booking.har', description: 'my past trips or bookings', expectedUrlPattern: '/user/trips', category: 'Travel', difficulty: 'hard' },

  // === Collaboration ===
  { id: 'collab-docs', fixture: 'realtime-collab.har', description: 'list of documents in a workspace', expectedUrlPattern: '/documents', category: 'Collab', difficulty: 'medium' },
  { id: 'collab-edit', fixture: 'realtime-collab.har', description: 'the collaborative editing operation that inserts text', expectedUrlPattern: '/changes', expectedBodyPattern: 'insert', category: 'Collab', difficulty: 'extreme' },
  { id: 'collab-create', fixture: 'realtime-collab.har', description: 'create a new document', expectedUrlPattern: '/documents', expectedBodyPattern: 'Meeting Notes', category: 'Collab', difficulty: 'hard' },
  { id: 'collab-comments', fixture: 'realtime-collab.har', description: 'comments on a document', expectedUrlPattern: '/comments', category: 'Collab', difficulty: 'medium' },
  { id: 'collab-export', fixture: 'realtime-collab.har', description: 'export document as PDF', expectedUrlPattern: '/export', expectedBodyPattern: 'pdf', category: 'Collab', difficulty: 'hard' },
  { id: 'collab-mention', fixture: 'realtime-collab.har', description: 'search for users to @mention', expectedUrlPattern: '/users/search', category: 'Collab', difficulty: 'hard' },
  { id: 'collab-history', fixture: 'realtime-collab.har', description: 'version history of a document', expectedUrlPattern: '/history', category: 'Collab', difficulty: 'hard' },

  // === Vague (extreme difficulty) ===
  { id: 'vague-buy', fixture: 'ecommerce.har', description: 'the API call that happens when you click buy', expectedUrlPattern: '/v1/orders', category: 'Vague', difficulty: 'extreme' },
  { id: 'vague-play', fixture: 'streaming-platform.har', description: 'what loads when you press play', expectedUrlPattern: '/playback/start', category: 'Vague', difficulty: 'extreme' },
  { id: 'vague-send-money', fixture: 'fintech-banking.har', description: 'sending money to someone', expectedUrlPattern: '/transfers', category: 'Vague', difficulty: 'extreme' },
  { id: 'vague-flights', fixture: 'travel-booking.har', description: 'the main search that kicks off when you look for flights', expectedUrlPattern: 'flights.example.com', category: 'Vague', difficulty: 'extreme' },
  { id: 'vague-typing', fixture: 'realtime-collab.har', description: 'typing in the editor', expectedUrlPattern: '/changes', category: 'Vague', difficulty: 'extreme' },
  { id: 'vague-chart', fixture: 'spa-dashboard.har', description: 'the main data that populates the chart', expectedUrlPattern: '/metrics/timeseries', category: 'Vague', difficulty: 'extreme' },
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

jest.setTimeout(900000); // 15 minutes — full suite is large

beforeAll(async () => {
  harParser = new HarParserService();

  // Check Ollama is running
  try {
    const resp = await fetch('http://localhost:11434/v1/models');
    if (!resp.ok) throw new Error('Ollama not responding');
    const data = await resp.json() as any;
    const available = (data.data || []).map((m: any) => m.id);
    console.log(`\nOllama models available: ${available.join(', ')}`);
  } catch {
    throw new Error('Ollama is not running. Start it with: ollama serve');
  }

  // Check which models are actually available and only test those
  for (const model of LOCAL_MODELS) {
    try {
      const resp = await fetch('http://localhost:11434/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
      });
      if (resp.ok) {
        const configService = {
          get: (key: string) => {
            if (key === 'LOCAL_LLM_MODEL') return model;
            if (key === 'LOCAL_LLM_BASE_URL') return 'http://localhost:11434/v1';
            return process.env[key];
          },
        } as unknown as ConfigService;
        services.set(model, new LocalLlmService(configService));
        console.log(`  [OK] ${model} — available`);
      } else {
        console.log(`  [SKIP] ${model} — not installed`);
      }
    } catch {
      console.log(`  [SKIP] ${model} — error checking`);
    }
  }

  if (services.size === 0) {
    throw new Error('No local models available. Pull at least one: ollama pull qwen2.5:3b');
  }

  console.log(`\nRunning ${evalCases.length} cases × ${services.size} models = ${evalCases.length * services.size} total evaluations\n`);
});

afterAll(() => {
  if (allResults.length === 0) return;

  // Ensure results directory exists
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  // Write CSV
  const timestamp = new Date().toISOString().split('T')[0];
  const csvPath = path.join(RESULTS_DIR, `local-full-eval-${timestamp}.csv`);
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
  const testedModels = [...new Set(allResults.map((r) => r.model))];

  console.log('\n' + '='.repeat(110));
  console.log('  LOCAL LLM FULL BENCHMARK — 63 CASES, ZERO API CALLS, ZERO COST');
  console.log('='.repeat(110));

  for (const model of testedModels) {
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
      const diffConf = diffCases.filter((r) => !r.error).reduce((s, r) => s + r.confidence, 0) / Math.max(diffCases.filter((r) => !r.error).length, 1);
      console.log(`      ${diff.padEnd(10)} ${p}/${diffCases.length} passed  (${(diffConf * 100).toFixed(0)}% avg conf)`);
    }

    // By category
    console.log('    By Category:');
    const cats = [...new Set(results.map((r) => r.category))];
    for (const cat of cats) {
      const catCases = results.filter((r) => r.category === cat);
      const p = catCases.filter((r) => r.passed).length;
      console.log(`      ${cat.padEnd(14)} ${p}/${catCases.length} passed`);
    }
  }

  // Head-to-head comparison
  console.log('\n' + '-'.repeat(110));
  console.log('  HEAD-TO-HEAD COMPARISON');
  console.log('-'.repeat(110));
  console.log('  ' + 'Model'.padEnd(20) + 'Accuracy'.padEnd(12) + 'Easy'.padEnd(10) + 'Medium'.padEnd(10) + 'Hard'.padEnd(10) + 'Extreme'.padEnd(10) + 'Avg Conf'.padEnd(12) + 'Avg Latency'.padEnd(14) + 'Cost');
  console.log('  ' + '-'.repeat(106));
  for (const model of testedModels) {
    const results = allResults.filter((r) => r.model === model);
    const passed = results.filter((r) => r.passed).length;
    const validResults = results.filter((r) => !r.error);
    const acc = ((passed / results.length) * 100).toFixed(1) + '%';
    const avgConf = validResults.length > 0
      ? (validResults.reduce((s, r) => s + r.confidence, 0) / validResults.length * 100).toFixed(1) + '%'
      : 'N/A';
    const avgLat = validResults.length > 0
      ? Math.round(validResults.reduce((s, r) => s + r.latency, 0) / validResults.length) + 'ms'
      : 'N/A';

    const byDiff = (d: string) => {
      const dc = results.filter((r) => r.difficulty === d);
      if (dc.length === 0) return 'N/A';
      const p = dc.filter((r) => r.passed).length;
      return `${p}/${dc.length}`;
    };

    console.log('  ' + model.padEnd(20) + acc.padEnd(12) + byDiff('easy').padEnd(10) + byDiff('medium').padEnd(10) + byDiff('hard').padEnd(10) + byDiff('extreme').padEnd(10) + avgConf.padEnd(12) + avgLat.padEnd(14) + '$0.00');
  }

  // Failed cases detail
  const failures = allResults.filter((r) => !r.passed);
  if (failures.length > 0) {
    console.log('\n' + '-'.repeat(110));
    console.log('  FAILURES:');
    console.log('-'.repeat(110));
    for (const f of failures) {
      const reason = f.error ? `ERR: ${f.error.substring(0, 60)}` : `Matched: ${f.matchedUrl.substring(0, 60)}`;
      console.log(`  ${f.model.padEnd(16)} ${f.id.padEnd(22)} [${f.difficulty}] Expected: ${f.expectedUrlPattern}`);
      console.log(`  ${''.padEnd(16)} ${reason}`);
    }
  }

  console.log('\n' + '='.repeat(110));
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
// Tests — one describe block per available model
// ---------------------------------------------------------------------------
for (const model of LOCAL_MODELS) {
  describe(`Full Eval: ${model}`, () => {
    test.each(evalCases)(
      '$id ($difficulty)',
      async (testCase: EvalCase) => {
        const service = services.get(model);
        if (!service) {
          console.log(`  [SKIP] ${model} not available`);
          return;
        }

        const { filtered, llmSummary } = getFixtureData(testCase.fixture);

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
          `  [${icon}] ${model.padEnd(16)} | ${testCase.id.padEnd(22)} | ${result.latency}ms | conf=${(result.confidence * 100).toFixed(0)}%${errMsg}`,
        );
      },
    );
  });
}
