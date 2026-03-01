/**
 * Groq/Llama eval runner — same 63 cases as eval.spec.ts but using Groq.
 *
 * Run:
 *   cd backend && npx jest eval-groq --testTimeout=120000 --runInBand --verbose
 *
 * Requires GROQ_API_KEY in the project root .env file.
 */

import * as path from 'path';
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
import { HarParserService } from './har-parser.service';
import { HarToCurlService } from './har-to-curl.service';
import { GroqService } from '../groq/groq.service';
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

// ---------------------------------------------------------------------------
// Eval case definitions — organized by difficulty and category
// ---------------------------------------------------------------------------
interface EvalCase {
  fixture: string;
  description: string;
  expectedUrlPattern: string;
  expectedBodyPattern?: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'extreme';
}

const evalCases: EvalCase[] = [
  // ========================================================================
  // CATEGORY: Basic API identification (warm-up)
  // ========================================================================
  {
    fixture: 'simple.har',
    description: 'the weather forecast API',
    expectedUrlPattern: '/v3/wx/forecast',
    category: 'Basic',
    difficulty: 'easy',
  },
  {
    fixture: 'simple.har',
    description: 'the joke API',
    expectedUrlPattern: 'joke-api.appspot.com',
    category: 'Basic',
    difficulty: 'easy',
  },
  {
    fixture: 'simple.har',
    description: 'the GraphQL weather alerts query',
    expectedUrlPattern: 'graphql',
    expectedBodyPattern: 'GetWeatherAlerts',
    category: 'Basic',
    difficulty: 'easy',
  },

  // ========================================================================
  // CATEGORY: Recipe app — moderate noise, clear API paths
  // ========================================================================
  {
    fixture: 'recipe-search.har',
    description: 'the recipe search API',
    expectedUrlPattern: '/v2/search',
    category: 'Recipe',
    difficulty: 'easy',
  },
  {
    fixture: 'recipe-search.har',
    description: 'recipe detail endpoint',
    expectedUrlPattern: '/v2/recipes/',
    category: 'Recipe',
    difficulty: 'easy',
  },
  {
    fixture: 'recipe-search.har',
    description: 'the endpoint that returns food categories',
    expectedUrlPattern: '/v2/categories',
    category: 'Recipe',
    difficulty: 'medium',
  },

  // ========================================================================
  // CATEGORY: E-commerce — multiple similar CRUD endpoints
  // ========================================================================
  {
    fixture: 'ecommerce.har',
    description: 'shopping cart API',
    expectedUrlPattern: '/v1/cart',
    category: 'E-commerce',
    difficulty: 'easy',
  },
  {
    fixture: 'ecommerce.har',
    description: 'the checkout or order creation endpoint',
    expectedUrlPattern: '/v1/orders',
    category: 'E-commerce',
    difficulty: 'medium',
  },
  {
    fixture: 'ecommerce.har',
    description: 'Stripe payment intent',
    expectedUrlPattern: 'payment_intents',
    category: 'E-commerce',
    difficulty: 'medium',
  },
  {
    fixture: 'ecommerce.har',
    description: 'API endpoint for listing products by category',
    expectedUrlPattern: '/v1/products?',
    category: 'E-commerce',
    difficulty: 'medium',
  },
  {
    fixture: 'ecommerce.har',
    description: 'the individual product detail page data',
    expectedUrlPattern: '/v1/products/8827',
    category: 'E-commerce',
    difficulty: 'medium',
  },
  {
    fixture: 'ecommerce.har',
    description: 'the token refresh endpoint',
    expectedUrlPattern: '/v1/auth/refresh',
    category: 'E-commerce',
    difficulty: 'hard',
  },

  // ========================================================================
  // CATEGORY: GraphQL — same URL, disambiguation by operationName
  // ========================================================================
  {
    fixture: 'graphql-app.har',
    description: 'the user profile query',
    expectedUrlPattern: 'graphql',
    expectedBodyPattern: 'GetUserProfile',
    category: 'GraphQL',
    difficulty: 'medium',
  },
  {
    fixture: 'graphql-app.har',
    description: 'the news feed or timeline',
    expectedUrlPattern: 'graphql',
    expectedBodyPattern: 'GetFeed',
    category: 'GraphQL',
    difficulty: 'medium',
  },
  {
    fixture: 'graphql-app.har',
    description: 'the create post mutation',
    expectedUrlPattern: 'graphql',
    expectedBodyPattern: 'CreatePost',
    category: 'GraphQL',
    difficulty: 'medium',
  },
  {
    fixture: 'graphql-app.har',
    description: 'the query that loads follower list',
    expectedUrlPattern: 'graphql',
    expectedBodyPattern: 'GetFollowers',
    category: 'GraphQL',
    difficulty: 'hard',
  },
  {
    fixture: 'graphql-app.har',
    description: 'notification data',
    expectedUrlPattern: 'graphql',
    expectedBodyPattern: 'GetNotifications',
    category: 'GraphQL',
    difficulty: 'hard',
  },

  // ========================================================================
  // CATEGORY: Multi-API noisy — high noise, multiple unrelated APIs
  // ========================================================================
  {
    fixture: 'multi-api-noisy.har',
    description: 'joke API',
    expectedUrlPattern: 'jokeapi',
    category: 'Noisy',
    difficulty: 'medium',
  },
  {
    fixture: 'multi-api-noisy.har',
    description: 'current weather data for a city',
    expectedUrlPattern: '/data/2.5/weather',
    category: 'Noisy',
    difficulty: 'medium',
  },
  {
    fixture: 'multi-api-noisy.har',
    description: 'email newsletter subscription',
    expectedUrlPattern: '/newsletter/subscribe',
    category: 'Noisy',
    difficulty: 'medium',
  },
  {
    fixture: 'multi-api-noisy.har',
    description: 'the 5-day weather forecast, not current conditions',
    expectedUrlPattern: '/data/2.5/forecast',
    category: 'Noisy',
    difficulty: 'hard',
  },

  // ========================================================================
  // CATEGORY: SPA Dashboard — massive noise, many similar metric endpoints
  // ========================================================================
  {
    fixture: 'spa-dashboard.har',
    description: 'CPU usage metrics time series',
    expectedUrlPattern: 'metric=cpu',
    category: 'Dashboard',
    difficulty: 'hard',
  },
  {
    fixture: 'spa-dashboard.har',
    description: 'active critical alerts',
    expectedUrlPattern: '/alerts',
    category: 'Dashboard',
    difficulty: 'medium',
  },
  {
    fixture: 'spa-dashboard.har',
    description: 'the dashboard configuration or layout',
    expectedUrlPattern: '/dashboards/d_',
    category: 'Dashboard',
    difficulty: 'hard',
  },
  {
    fixture: 'spa-dashboard.har',
    description: 'add a new widget to a dashboard',
    expectedUrlPattern: '/widgets',
    expectedBodyPattern: 'timeseries',
    category: 'Dashboard',
    difficulty: 'hard',
  },
  {
    fixture: 'spa-dashboard.har',
    description: 'the current user profile endpoint',
    expectedUrlPattern: '/users/me',
    category: 'Dashboard',
    difficulty: 'medium',
  },
  {
    fixture: 'spa-dashboard.har',
    description: 'search for metrics',
    expectedUrlPattern: '/search',
    expectedBodyPattern: 'error rate',
    category: 'Dashboard',
    difficulty: 'hard',
  },
  {
    fixture: 'spa-dashboard.har',
    description: 'the service map GraphQL query',
    expectedUrlPattern: 'graphql',
    expectedBodyPattern: 'GetServiceMap',
    category: 'Dashboard',
    difficulty: 'extreme',
  },
  {
    fixture: 'spa-dashboard.har',
    description: 'the list of third-party integrations',
    expectedUrlPattern: '/integrations',
    category: 'Dashboard',
    difficulty: 'hard',
  },

  // ========================================================================
  // CATEGORY: Streaming platform — media APIs, similar search patterns
  // ========================================================================
  {
    fixture: 'streaming-platform.har',
    description: 'search for TV shows or movies',
    expectedUrlPattern: '/catalog/search',
    category: 'Streaming',
    difficulty: 'medium',
  },
  {
    fixture: 'streaming-platform.har',
    description: 'details about a specific title including cast and synopsis',
    expectedUrlPattern: '/catalog/titles/tt_',
    category: 'Streaming',
    difficulty: 'medium',
  },
  {
    fixture: 'streaming-platform.har',
    description: 'episode list for a season',
    expectedUrlPattern: '/episodes',
    category: 'Streaming',
    difficulty: 'medium',
  },
  {
    fixture: 'streaming-platform.har',
    description: 'start video playback and get the streaming URL',
    expectedUrlPattern: '/playback/start',
    expectedBodyPattern: 'titleId',
    category: 'Streaming',
    difficulty: 'hard',
  },
  {
    fixture: 'streaming-platform.har',
    description: 'add something to my watchlist',
    expectedUrlPattern: '/watchlist',
    expectedBodyPattern: 'add',
    category: 'Streaming',
    difficulty: 'hard',
  },
  {
    fixture: 'streaming-platform.har',
    description: 'personalized content recommendations',
    expectedUrlPattern: '/recommendations',
    category: 'Streaming',
    difficulty: 'medium',
  },
  {
    fixture: 'streaming-platform.har',
    description: 'the video manifest for adaptive streaming',
    expectedUrlPattern: '.mpd',
    category: 'Streaming',
    difficulty: 'extreme',
  },

  // ========================================================================
  // CATEGORY: Fintech banking — security-sensitive, similar CRUD
  // ========================================================================
  {
    fixture: 'fintech-banking.har',
    description: 'list of bank accounts',
    expectedUrlPattern: '/accounts',
    category: 'Fintech',
    difficulty: 'medium',
  },
  {
    fixture: 'fintech-banking.har',
    description: 'transaction history',
    expectedUrlPattern: '/transactions',
    category: 'Fintech',
    difficulty: 'medium',
  },
  {
    fixture: 'fintech-banking.har',
    description: 'the money transfer or send money endpoint',
    expectedUrlPattern: '/transfers',
    expectedBodyPattern: 'fromAccount',
    category: 'Fintech',
    difficulty: 'hard',
  },
  {
    fixture: 'fintech-banking.har',
    description: 'check account balance',
    expectedUrlPattern: '/balance',
    category: 'Fintech',
    difficulty: 'hard',
  },
  {
    fixture: 'fintech-banking.har',
    description: 'schedule a recurring bill payment',
    expectedUrlPattern: '/payments/schedule',
    expectedBodyPattern: 'recurring',
    category: 'Fintech',
    difficulty: 'hard',
  },
  {
    fixture: 'fintech-banking.har',
    description: 'freeze or lock a credit card',
    expectedUrlPattern: '/freeze',
    expectedBodyPattern: 'lost',
    category: 'Fintech',
    difficulty: 'extreme',
  },
  {
    fixture: 'fintech-banking.har',
    description: 'saved payees or beneficiaries list',
    expectedUrlPattern: '/payees',
    category: 'Fintech',
    difficulty: 'hard',
  },

  // ========================================================================
  // CATEGORY: Travel booking — multiple third-party APIs
  // ========================================================================
  {
    fixture: 'travel-booking.har',
    description: 'flight search from San Francisco to Tokyo',
    expectedUrlPattern: 'flights.example.com',
    expectedBodyPattern: 'SFO',
    category: 'Travel',
    difficulty: 'medium',
  },
  {
    fixture: 'travel-booking.har',
    description: 'hotel search in a city',
    expectedUrlPattern: 'hotels.example.com',
    expectedBodyPattern: 'Tokyo',
    category: 'Travel',
    difficulty: 'medium',
  },
  {
    fixture: 'travel-booking.har',
    description: 'available room types and pricing for a specific hotel',
    expectedUrlPattern: '/rooms',
    category: 'Travel',
    difficulty: 'hard',
  },
  {
    fixture: 'travel-booking.har',
    description: 'the final booking or reservation creation',
    expectedUrlPattern: '/reservations',
    expectedBodyPattern: 'flightId',
    category: 'Travel',
    difficulty: 'hard',
  },
  {
    fixture: 'travel-booking.har',
    description: 'currency exchange rates for USD to JPY',
    expectedUrlPattern: 'exchangerate',
    category: 'Travel',
    difficulty: 'hard',
  },
  {
    fixture: 'travel-booking.har',
    description: 'the Google Maps geocoding request',
    expectedUrlPattern: 'maps.googleapis.com',
    category: 'Travel',
    difficulty: 'medium',
  },
  {
    fixture: 'travel-booking.har',
    description: 'my past trips or bookings',
    expectedUrlPattern: '/user/trips',
    category: 'Travel',
    difficulty: 'hard',
  },

  // ========================================================================
  // CATEGORY: Real-time collaboration — WebSocket-heavy, doc operations
  // ========================================================================
  {
    fixture: 'realtime-collab.har',
    description: 'list of documents in a workspace',
    expectedUrlPattern: '/documents',
    category: 'Collab',
    difficulty: 'medium',
  },
  {
    fixture: 'realtime-collab.har',
    description: 'the collaborative editing operation that inserts text',
    expectedUrlPattern: '/changes',
    expectedBodyPattern: 'insert',
    category: 'Collab',
    difficulty: 'extreme',
  },
  {
    fixture: 'realtime-collab.har',
    description: 'create a new document',
    expectedUrlPattern: '/documents',
    expectedBodyPattern: 'Meeting Notes',
    category: 'Collab',
    difficulty: 'hard',
  },
  {
    fixture: 'realtime-collab.har',
    description: 'comments on a document',
    expectedUrlPattern: '/comments',
    category: 'Collab',
    difficulty: 'medium',
  },
  {
    fixture: 'realtime-collab.har',
    description: 'export document as PDF',
    expectedUrlPattern: '/export',
    expectedBodyPattern: 'pdf',
    category: 'Collab',
    difficulty: 'hard',
  },
  {
    fixture: 'realtime-collab.har',
    description: 'search for users to @mention',
    expectedUrlPattern: '/users/search',
    category: 'Collab',
    difficulty: 'hard',
  },
  {
    fixture: 'realtime-collab.har',
    description: 'version history of a document',
    expectedUrlPattern: '/history',
    category: 'Collab',
    difficulty: 'hard',
  },

  // ========================================================================
  // CATEGORY: Vague / natural language descriptions (stress test LLM)
  // ========================================================================
  {
    fixture: 'ecommerce.har',
    description: 'the API call that happens when you click buy',
    expectedUrlPattern: '/v1/orders',
    category: 'Vague',
    difficulty: 'extreme',
  },
  {
    fixture: 'streaming-platform.har',
    description: 'what loads when you press play',
    expectedUrlPattern: '/playback/start',
    category: 'Vague',
    difficulty: 'extreme',
  },
  {
    fixture: 'fintech-banking.har',
    description: 'sending money to someone',
    expectedUrlPattern: '/transfers',
    category: 'Vague',
    difficulty: 'extreme',
  },
  {
    fixture: 'travel-booking.har',
    description: 'the main search that kicks off when you look for flights',
    expectedUrlPattern: 'flights.example.com',
    category: 'Vague',
    difficulty: 'extreme',
  },
  {
    fixture: 'realtime-collab.har',
    description: 'typing in the editor',
    expectedUrlPattern: '/changes',
    category: 'Vague',
    difficulty: 'extreme',
  },
  {
    fixture: 'spa-dashboard.har',
    description: 'the main data that populates the chart',
    expectedUrlPattern: '/metrics/timeseries',
    category: 'Vague',
    difficulty: 'extreme',
  },
];

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
let harParser: HarParserService;
let harToCurl: HarToCurlService;
let groq: GroqService;

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------
interface EvalResult {
  fixture: string;
  description: string;
  category: string;
  difficulty: string;
  passed: boolean;
  matchedUrl: string;
  expectedUrlPattern: string;
  expectedBodyPattern?: string;
  confidence: number;
  reason: string;
  bodyMatched?: boolean;
  totalEntries: number;
  filteredEntries: number;
  inputTokens: number;
}

const results: EvalResult[] = [];
let totalInputTokens = 0;
let totalOutputTokens = 0;

jest.setTimeout(120000);

beforeAll(() => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY required. Set it in the project root .env file.');
  }

  harParser = new HarParserService();
  harToCurl = new HarToCurlService();

  const configService = {
    get: (key: string) => process.env[key],
  } as unknown as ConfigService;
  groq = new GroqService(configService);
});

afterAll(() => {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const avgConfidence =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
      : 0;

  // Group by category
  const categories = new Map<string, EvalResult[]>();
  for (const r of results) {
    if (!categories.has(r.category)) categories.set(r.category, []);
    categories.get(r.category)!.push(r);
  }

  // Group by difficulty
  const difficulties = new Map<string, EvalResult[]>();
  for (const r of results) {
    if (!difficulties.has(r.difficulty)) difficulties.set(r.difficulty, []);
    difficulties.get(r.difficulty)!.push(r);
  }

  console.log('\n');
  console.log('='.repeat(90));
  console.log('  GROQ/LLAMA EVAL SUMMARY');
  console.log('='.repeat(90));
  console.log(`  Total: ${results.length}  |  Passed: ${passed}  |  Failed: ${failed}  |  Pass rate: ${((passed / results.length) * 100).toFixed(1)}%`);
  console.log(`  Average confidence: ${(avgConfidence * 100).toFixed(1)}%`);
  console.log('-'.repeat(90));

  // By difficulty
  console.log('\n  BY DIFFICULTY:');
  for (const diff of ['easy', 'medium', 'hard', 'extreme']) {
    const cases = difficulties.get(diff) || [];
    const p = cases.filter((r) => r.passed).length;
    const avgConf = cases.length > 0 ? cases.reduce((s, r) => s + r.confidence, 0) / cases.length : 0;
    console.log(`    ${diff.toUpperCase().padEnd(10)} ${p}/${cases.length} passed  (avg confidence: ${(avgConf * 100).toFixed(0)}%)`);
  }

  // By category
  console.log('\n  BY CATEGORY:');
  for (const [cat, cases] of categories) {
    const p = cases.filter((r) => r.passed).length;
    const avgConf = cases.reduce((s, r) => s + r.confidence, 0) / cases.length;
    console.log(`    ${cat.padEnd(14)} ${p}/${cases.length} passed  (avg confidence: ${(avgConf * 100).toFixed(0)}%)`);
  }

  // Detailed results
  console.log('\n' + '-'.repeat(90));
  console.log('  DETAILED RESULTS:');
  console.log('-'.repeat(90));

  for (const r of results) {
    const icon = r.passed ? 'PASS' : 'FAIL';
    const bodyInfo = r.expectedBodyPattern !== undefined
      ? ` (body ${r.bodyMatched ? 'ok' : 'MISSED'})`
      : '';
    const filterInfo = `[${r.filteredEntries}/${r.totalEntries} entries]`;
    console.log(
      `  [${icon}] ${r.difficulty.padEnd(8)} ${r.category.padEnd(12)} "${r.description}"`,
    );
    console.log(
      `         → ${r.matchedUrl.substring(0, 80)} (${(r.confidence * 100).toFixed(0)}%) ${filterInfo}${bodyInfo}`,
    );
    if (!r.passed) {
      console.log(`         ✗ Expected: ${r.expectedUrlPattern}`);
      console.log(`         ✗ Reason: ${r.reason}`);
    }
  }

  console.log('\n' + '='.repeat(90));
});

// ---------------------------------------------------------------------------
// Cache parsed fixtures to avoid re-reading
// ---------------------------------------------------------------------------
const fixtureCache = new Map<string, { allEntries: Entry[]; filtered: Entry[]; llmSummary: string }>();

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
  const { summary: llmSummary } = harParser.generateLlmSummary(filtered, allEntries.length);

  const data = { allEntries, filtered, llmSummary };
  fixtureCache.set(fixture, data);
  return data;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('HAR Analysis Eval (Groq/Llama)', () => {
  test.each(evalCases)(
    '[$difficulty] $category: "$description"',
    async ({ fixture, description, expectedUrlPattern, expectedBodyPattern, category, difficulty }: EvalCase) => {
      const { allEntries, filtered, llmSummary } = getFixtureData(fixture);
      expect(filtered.length).toBeGreaterThan(0);

      const llmResult = await groq.identifyApiRequest(
        llmSummary,
        description,
        filtered.length,
      );

      const matchedEntry = filtered[llmResult.matchIndex];
      const matchedUrl = matchedEntry.request.url;
      const matchedBody = matchedEntry.request.postData?.text || '';

      const urlMatched = matchedUrl.includes(expectedUrlPattern);
      let bodyMatched: boolean | undefined;
      if (expectedBodyPattern) {
        bodyMatched = matchedBody.includes(expectedBodyPattern);
      }

      const passed = urlMatched && (bodyMatched === undefined || bodyMatched);

      results.push({
        fixture,
        description,
        category,
        difficulty,
        passed,
        matchedUrl,
        expectedUrlPattern,
        expectedBodyPattern,
        confidence: llmResult.confidence,
        reason: llmResult.reason,
        bodyMatched,
        totalEntries: allEntries.length,
        filteredEntries: filtered.length,
        inputTokens: Math.round(llmSummary.length / 4),
      });

      expect(urlMatched).toBe(true);
      if (expectedBodyPattern) {
        expect(bodyMatched).toBe(true);
      }
    },
  );
});
