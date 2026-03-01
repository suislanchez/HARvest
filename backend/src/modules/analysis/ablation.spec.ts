/**
 * Ablation Study & Cross-Model Benchmark for HAR API Discovery
 *
 * Three experiments:
 *   A. Filter Layer Ablations — disable each filter one at a time
 *   B. Cross-Model Comparison — GPT-4o-mini vs Llama-3.3-70b (Groq)
 *   C. Keyword Baseline — no LLM, pure keyword/URL grep
 *
 * Run:
 *   cd backend && GROQ_API_KEY=... npx jest ablation --testTimeout=600000 --runInBand --verbose
 *
 * Requires OPENAI_API_KEY and optionally GROQ_API_KEY in the project root .env file.
 */

import * as path from 'path';
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
import { HarParserService, FilterOptions } from './har-parser.service';
import { OpenaiService } from '../openai/openai.service';
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

// ---------------------------------------------------------------------------
// Ground truth
// ---------------------------------------------------------------------------
interface BenchmarkCase {
  id: string;
  harFile: string;
  description: string;
  expectedUrlPattern: string;
  expectedBodyPattern?: string;
  expectedMethod: string;
  difficulty: string;
  category: string;
}

const BENCHMARK_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'benchmark', 'ground-truth.json');
const RESULTS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'benchmark', 'results');
const FIXTURES_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// Load benchmark cases at module level so test.each() can see them
if (!fs.existsSync(BENCHMARK_PATH)) {
  throw new Error(`Benchmark ground truth not found: ${BENCHMARK_PATH}`);
}
const benchmarkCases: BenchmarkCase[] = JSON.parse(fs.readFileSync(BENCHMARK_PATH, 'utf-8')).cases;

// ---------------------------------------------------------------------------
// Ablation configs
// ---------------------------------------------------------------------------
interface AblationConfig {
  name: string;
  filterOptions: FilterOptions;
  skipDedup: boolean;
}

const ABLATION_CONFIGS: AblationConfig[] = [
  { name: 'baseline', filterOptions: {}, skipDedup: false },
  { name: 'no-data-uri-filter', filterOptions: { skipDataUris: false }, skipDedup: false },
  { name: 'no-failed-filter', filterOptions: { skipFailed: false }, skipDedup: false },
  { name: 'no-cors-filter', filterOptions: { skipCors: false }, skipDedup: false },
  { name: 'no-redirect-filter', filterOptions: { skipRedirects: false }, skipDedup: false },
  { name: 'no-static-filter', filterOptions: { skipStaticFiles: false }, skipDedup: false },
  { name: 'no-tracking-filter', filterOptions: { skipTrackingDomains: false }, skipDedup: false },
  { name: 'no-mime-filter', filterOptions: { skipMimeTypes: false }, skipDedup: false },
  { name: 'no-media-filter', filterOptions: { skipMedia: false }, skipDedup: false },
  { name: 'no-dedup', filterOptions: {}, skipDedup: true },
  {
    name: 'no-filtering',
    filterOptions: {
      skipDataUris: false,
      skipFailed: false,
      skipCors: false,
      skipRedirects: false,
      skipStaticFiles: false,
      skipTrackingDomains: false,
      skipMimeTypes: false,
      skipMedia: false,
    },
    skipDedup: true,
  },
];

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------
interface AblationResult {
  testId: string;
  model: string;
  ablation: string;
  correct: boolean;
  confidence: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  latency: number;
  totalEntries: number;
  filteredEntries: number;
  uniqueEntries: number;
}

const allResults: AblationResult[] = [];

// ---------------------------------------------------------------------------
// Cost helpers (per 1M tokens)
// ---------------------------------------------------------------------------
const COST_TABLE: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const rates = COST_TABLE[model] || { input: 0.15, output: 0.60 };
  return (promptTokens * rates.input + completionTokens * rates.output) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
let harParser: HarParserService;
let openaiService: OpenaiService | null = null;
let groqService: GroqService | null = null;

jest.setTimeout(600000);

beforeAll(() => {
  // Ensure results directory exists
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  harParser = new HarParserService();

  const configService = {
    get: (key: string) => process.env[key],
  } as unknown as ConfigService;

  // Initialize OpenAI (required)
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY required. Set it in the project root .env file.');
  }
  openaiService = new OpenaiService(configService);

  // Initialize Groq (optional)
  if (process.env.GROQ_API_KEY) {
    groqService = new GroqService(configService);
  } else {
    console.warn('GROQ_API_KEY not set — skipping Groq/Llama cross-model tests');
  }
});

afterAll(() => {
  if (allResults.length === 0) return;

  // Write CSV
  const timestamp = new Date().toISOString().split('T')[0];
  const csvPath = path.join(RESULTS_DIR, `ablation-${timestamp}.csv`);
  const headers = [
    'testId', 'model', 'ablation', 'correct', 'confidence',
    'promptTokens', 'completionTokens', 'cost', 'latency',
    'totalEntries', 'filteredEntries', 'uniqueEntries',
  ];
  const csvLines = [headers.join(',')];
  for (const r of allResults) {
    csvLines.push([
      r.testId, r.model, r.ablation, r.correct, r.confidence.toFixed(3),
      r.promptTokens, r.completionTokens, r.cost.toFixed(6), r.latency,
      r.totalEntries, r.filteredEntries, r.uniqueEntries,
    ].join(','));
  }
  fs.writeFileSync(csvPath, csvLines.join('\n') + '\n');
  console.log(`\nCSV written to: ${csvPath}`);

  // Console summary table
  printSummary();
});

function printSummary(): void {
  console.log('\n' + '='.repeat(100));
  console.log('  ABLATION STUDY SUMMARY');
  console.log('='.repeat(100));

  // Group by ablation config
  const byAblation = new Map<string, AblationResult[]>();
  for (const r of allResults) {
    const key = `${r.model}:${r.ablation}`;
    if (!byAblation.has(key)) byAblation.set(key, []);
    byAblation.get(key)!.push(r);
  }

  console.log(
    '\n  ' +
    'Config'.padEnd(30) +
    'Model'.padEnd(28) +
    'Acc'.padEnd(8) +
    'AvgConf'.padEnd(10) +
    'AvgTokens'.padEnd(12) +
    'AvgCost'.padEnd(12) +
    'AvgLatency',
  );
  console.log('  ' + '-'.repeat(96));

  for (const [key, results] of byAblation) {
    const [model, ablation] = key.split(':');
    const correct = results.filter((r) => r.correct).length;
    const accuracy = ((correct / results.length) * 100).toFixed(1) + '%';
    const avgConf = (results.reduce((s, r) => s + r.confidence, 0) / results.length * 100).toFixed(1) + '%';
    const avgTokens = Math.round(results.reduce((s, r) => s + r.promptTokens, 0) / results.length);
    const avgCost = (results.reduce((s, r) => s + r.cost, 0) / results.length).toFixed(5);
    const avgLatency = Math.round(results.reduce((s, r) => s + r.latency, 0) / results.length);

    console.log(
      '  ' +
      ablation.padEnd(30) +
      model.padEnd(28) +
      accuracy.padEnd(8) +
      avgConf.padEnd(10) +
      String(avgTokens).padEnd(12) +
      ('$' + avgCost).padEnd(12) +
      avgLatency + 'ms',
    );
  }

  console.log('\n' + '='.repeat(100));
}

// ---------------------------------------------------------------------------
// Fixture cache
// ---------------------------------------------------------------------------
const fixtureCache = new Map<string, Entry[]>();

function loadEntries(harFile: string): Entry[] {
  if (fixtureCache.has(harFile)) return fixtureCache.get(harFile)!;

  const fullPath = path.join(FIXTURES_ROOT, harFile);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`HAR file not found: ${fullPath}`);
  }
  const buffer = fs.readFileSync(fullPath);
  const har = harParser.parseHar(buffer as unknown as Buffer);
  const entries = har.log.entries;
  fixtureCache.set(harFile, entries);
  return entries;
}

// ---------------------------------------------------------------------------
// Runner helpers
// ---------------------------------------------------------------------------
async function runLlmTest(
  testCase: BenchmarkCase,
  ablation: AblationConfig,
  service: OpenaiService | GroqService,
  modelName: string,
): Promise<AblationResult> {
  const allEntries = loadEntries(testCase.harFile);
  const filtered = harParser.filterApiRequests(allEntries, ablation.filterOptions);

  const { summary, uniqueCount } = ablation.skipDedup
    ? (() => {
        // Generate summary without dedup by summarizing all filtered entries
        const summaries = harParser.summarizeEntries(filtered);
        const summaryText = summaries.map((s) => s.summary).join('\n');
        const header = `=== HAR Analysis: ${filtered.length} API requests from ${allEntries.length} total ===`;
        return { summary: `${header}\n\n${summaryText}`, uniqueCount: filtered.length };
      })()
    : harParser.generateLlmSummary(filtered, allEntries.length);

  const start = Date.now();
  const llmResult = await service.identifyApiRequest(
    summary,
    testCase.description,
    ablation.skipDedup ? filtered.length : uniqueCount,
  );
  const latency = Date.now() - start;

  // Check correctness
  const entryPool = ablation.skipDedup ? filtered : filtered;
  const matchedEntry = entryPool[llmResult.matchIndex];
  const matchedUrl = matchedEntry?.request.url || '';
  const matchedBody = matchedEntry?.request.postData?.text || '';

  const urlCorrect = matchedUrl.includes(testCase.expectedUrlPattern);
  const bodyCorrect = testCase.expectedBodyPattern
    ? matchedBody.includes(testCase.expectedBodyPattern)
    : true;
  const correct = urlCorrect && bodyCorrect;

  const cost = estimateCost(modelName, llmResult.promptTokens, llmResult.completionTokens);

  return {
    testId: testCase.id,
    model: modelName,
    ablation: ablation.name,
    correct,
    confidence: llmResult.confidence,
    promptTokens: llmResult.promptTokens,
    completionTokens: llmResult.completionTokens,
    cost,
    latency,
    totalEntries: allEntries.length,
    filteredEntries: filtered.length,
    uniqueEntries: uniqueCount,
  };
}

function runKeywordTest(testCase: BenchmarkCase): AblationResult {
  const allEntries = loadEntries(testCase.harFile);
  const filtered = harParser.filterApiRequests(allEntries);

  // Simple keyword matching: search for description words in URLs and bodies
  const keywords = testCase.description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !['the', 'that', 'this', 'from', 'when', 'what', 'with', 'find', 'endpoint', 'data'].includes(w));

  let bestIdx = -1;
  let bestScore = 0;

  filtered.forEach((entry, idx) => {
    const url = entry.request.url.toLowerCase();
    const body = (entry.request.postData?.text || '').toLowerCase();
    const responseBody = (entry.response.content?.text || '').toLowerCase();
    const searchText = `${url} ${body} ${responseBody}`;

    let score = 0;
    for (const kw of keywords) {
      if (searchText.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  // Fallback: if no keywords matched, pick first JSON response
  if (bestIdx === -1) {
    bestIdx = filtered.findIndex((e) =>
      (e.response.content?.mimeType || '').includes('json'),
    );
    if (bestIdx === -1) bestIdx = 0;
  }

  const matchedEntry = filtered[bestIdx];
  const matchedUrl = matchedEntry?.request.url || '';
  const matchedBody = matchedEntry?.request.postData?.text || '';

  const urlCorrect = matchedUrl.includes(testCase.expectedUrlPattern);
  const bodyCorrect = testCase.expectedBodyPattern
    ? matchedBody.includes(testCase.expectedBodyPattern)
    : true;
  const correct = urlCorrect && bodyCorrect;

  const { uniqueCount } = harParser.generateLlmSummary(filtered, allEntries.length);

  return {
    testId: testCase.id,
    model: 'keyword-baseline',
    ablation: 'keyword-only',
    correct,
    confidence: bestScore > 0 ? Math.min(bestScore / keywords.length, 1) : 0,
    promptTokens: 0,
    completionTokens: 0,
    cost: 0,
    latency: 0,
    totalEntries: allEntries.length,
    filteredEntries: filtered.length,
    uniqueEntries: uniqueCount,
  };
}

// ---------------------------------------------------------------------------
// A. Filter Layer Ablations (OpenAI baseline model)
// ---------------------------------------------------------------------------
describe('A. Filter Layer Ablations', () => {
  // Use a representative subset for ablation (avoid excessive API costs)
  const ablationCaseIds = [
    'simple-weather', 'simple-joke', 'recipe-search', 'ecommerce-cart',
    'ecommerce-orders', 'graphql-profile', 'noisy-joke', 'noisy-weather',
    'dashboard-alerts', 'streaming-search', 'fintech-accounts',
    'fintech-transfers', 'travel-flights', 'collab-documents', 'vague-buy',
  ];

  for (const config of ABLATION_CONFIGS) {
    describe(`Config: ${config.name}`, () => {
      const cases = benchmarkCases.filter((c) => ablationCaseIds.includes(c.id));

      test.each(cases)(
        '$id',
        async (testCase: BenchmarkCase) => {
          const result = await runLlmTest(testCase, config, openaiService!, process.env.OPENAI_MODEL || 'gpt-4o-mini');
          allResults.push(result);

          // Log inline for verbose mode
          const icon = result.correct ? 'PASS' : 'FAIL';
          console.log(
            `  [${icon}] ${config.name} | ${testCase.id} | conf=${(result.confidence * 100).toFixed(0)}% | ${result.filteredEntries}/${result.totalEntries} entries | ${result.latency}ms`,
          );
        },
      );
    });
  }
});

// ---------------------------------------------------------------------------
// B. Cross-Model Comparison (OpenAI vs Groq/Llama)
// ---------------------------------------------------------------------------
describe('B. Cross-Model Comparison', () => {
  const crossModelCaseIds = [
    'simple-weather', 'simple-joke', 'recipe-search', 'ecommerce-cart',
    'ecommerce-orders', 'graphql-profile', 'noisy-joke', 'noisy-weather',
    'dashboard-alerts', 'streaming-search', 'fintech-accounts',
    'fintech-transfers', 'travel-flights', 'collab-documents', 'vague-buy',
  ];

  const baselineConfig = ABLATION_CONFIGS[0]; // baseline (all filters on)

  describe('Groq/Llama', () => {
    const cases = benchmarkCases.filter((c) => crossModelCaseIds.includes(c.id));

    test.each(cases)(
      '$id',
      async (testCase: BenchmarkCase) => {
        if (!groqService) {
          console.log(`  [SKIP] Groq not configured — ${testCase.id}`);
          return;
        }

        const groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
        const result = await runLlmTest(testCase, baselineConfig, groqService, groqModel);
        allResults.push(result);

        const icon = result.correct ? 'PASS' : 'FAIL';
        console.log(
          `  [${icon}] groq/${groqModel} | ${testCase.id} | conf=${(result.confidence * 100).toFixed(0)}% | ${result.latency}ms | $${result.cost.toFixed(5)}`,
        );
      },
    );
  });
});

// ---------------------------------------------------------------------------
// C. Keyword Baseline (No LLM)
// ---------------------------------------------------------------------------
describe('C. Keyword Baseline', () => {
  const keywordCaseIds = [
    'simple-weather', 'simple-joke', 'recipe-search', 'ecommerce-cart',
    'ecommerce-orders', 'graphql-profile', 'noisy-joke', 'noisy-weather',
    'dashboard-alerts', 'streaming-search', 'fintech-accounts',
    'fintech-transfers', 'travel-flights', 'collab-documents', 'vague-buy',
  ];

  const cases = benchmarkCases.filter((c) => keywordCaseIds.includes(c.id));

  test.each(cases)(
    '$id',
    (testCase: BenchmarkCase) => {
      const result = runKeywordTest(testCase);
      allResults.push(result);

      const icon = result.correct ? 'PASS' : 'FAIL';
      console.log(
        `  [${icon}] keyword | ${testCase.id} | score=${(result.confidence * 100).toFixed(0)}% | ${result.filteredEntries}/${result.totalEntries} entries`,
      );
    },
  );
});
