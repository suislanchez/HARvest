/**
 * Expanded E2E tests with diverse real-world public APIs.
 *
 * Tests 10 additional public APIs covering:
 *   - Government / science (USGS Earthquake, NASA APOD)
 *   - Weather (Open-Meteo)
 *   - Culture / art (Met Museum)
 *   - News / social (Hacker News, Reddit)
 *   - Finance (CoinGecko, Exchange Rate)
 *   - Gaming / entertainment (PokeAPI)
 *   - User data (Random User)
 *
 * Full pipeline: HAR → parse → filter → LLM match → curl gen → execute
 *
 * Run:
 *   cd backend && npx jest e2e-live-expanded --testTimeout=60000 --verbose
 *
 * Requires OPENAI_API_KEY in the project root .env file.
 */

import * as path from 'path';
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
import { HarParserService } from './har-parser.service';
import { HarToCurlService, ParsedCurlRequest } from './har-to-curl.service';
import { OpenaiService } from '../openai/openai.service';
import type { Entry, Har } from 'har-format';

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
// Services (real, not mocked)
// ---------------------------------------------------------------------------
let harParser: HarParserService;
let harToCurl: HarToCurlService;
let openai: OpenaiService;

jest.setTimeout(60000);

beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY required. Set it in the project root .env file.');
  }

  harParser = new HarParserService();
  harToCurl = new HarToCurlService();

  const configService = {
    get: (key: string) => process.env[key],
  } as unknown as ConfigService;
  openai = new OpenaiService(configService);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHar(entries: Entry[]): Har {
  return {
    log: {
      version: '1.2',
      creator: { name: 'e2e-expanded-test', version: '1.0' },
      entries,
      pages: [],
    },
  };
}

function makeEntry(opts: {
  method: string;
  url: string;
  status: number;
  requestHeaders?: Array<{ name: string; value: string }>;
  responseHeaders?: Array<{ name: string; value: string }>;
  responseMimeType?: string;
  responseBody?: string;
  postData?: { mimeType: string; text: string };
}): Entry {
  return {
    startedDateTime: new Date().toISOString(),
    time: 100,
    request: {
      method: opts.method,
      url: opts.url,
      httpVersion: 'HTTP/2.0',
      cookies: [],
      headers: opts.requestHeaders || [
        { name: 'Accept', value: 'application/json' },
        { name: 'User-Agent', value: 'Mozilla/5.0' },
      ],
      queryString: [],
      headersSize: -1,
      bodySize: opts.postData ? opts.postData.text.length : -1,
      ...(opts.postData ? { postData: opts.postData } : {}),
    },
    response: {
      status: opts.status,
      statusText: opts.status === 200 ? 'OK' : opts.status === 201 ? 'Created' : 'Unknown',
      httpVersion: 'HTTP/2.0',
      cookies: [],
      headers: opts.responseHeaders || [
        { name: 'Content-Type', value: opts.responseMimeType || 'application/json' },
      ],
      content: {
        size: opts.responseBody?.length || 100,
        mimeType: opts.responseMimeType || 'application/json',
        ...(opts.responseBody ? { text: opts.responseBody } : {}),
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: opts.responseBody?.length || 100,
    },
    cache: {},
    timings: { send: 1, wait: 50, receive: 10 },
  } as Entry;
}

function noiseEntries(): Entry[] {
  return [
    makeEntry({ method: 'GET', url: 'https://www.google-analytics.com/collect?v=1&tid=UA-123', status: 200, responseMimeType: 'image/gif' }),
    makeEntry({ method: 'GET', url: 'https://cdn.example.com/bundle.js', status: 200, responseMimeType: 'application/javascript' }),
    makeEntry({ method: 'GET', url: 'https://fonts.googleapis.com/css2?family=Roboto', status: 200, responseMimeType: 'text/css' }),
    makeEntry({ method: 'GET', url: 'https://example.com/favicon.ico', status: 200, responseMimeType: 'image/x-icon' }),
    makeEntry({ method: 'OPTIONS', url: 'https://api.example.com/preflight', status: 204 }),
    makeEntry({ method: 'GET', url: 'https://www.facebook.com/tr/?id=123', status: 200, responseMimeType: 'image/gif' }),
  ];
}

async function executeCurl(curlCmd: string): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const parsed = harToCurl.parseCurlToRequest(curlCmd);

  const fetchOpts: RequestInit = {
    method: parsed.method,
    headers: parsed.headers,
    signal: AbortSignal.timeout(30000),
  };

  if (parsed.body && parsed.method !== 'GET' && parsed.method !== 'HEAD') {
    fetchOpts.body = parsed.body;
  }

  const res = await fetch(parsed.url, fetchOpts);
  const body = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });

  return { status: res.status, headers, body };
}

async function runFullPipeline(entries: Entry[], description: string): Promise<{
  curl: string;
  parsed: ParsedCurlRequest;
  matchedUrl: string;
  confidence: number;
  execution: { status: number; headers: Record<string, string>; body: string };
}> {
  const har = buildHar(entries);
  const buffer = Buffer.from(JSON.stringify(har));

  const parsed = harParser.parseHar(buffer);
  const filtered = harParser.filterApiRequests(parsed.log.entries);
  expect(filtered.length).toBeGreaterThan(0);

  const { summary: llmSummary } = harParser.generateLlmSummary(filtered, parsed.log.entries.length);
  const llmResult = await openai.identifyApiRequest(llmSummary, description, filtered.length);

  const matchedEntry = filtered[llmResult.matchIndex];
  const matchedUrl = matchedEntry.request.url;

  const curl = harToCurl.generateCurl(matchedEntry);
  expect(curl).toContain('curl');

  const parsedCurl = harToCurl.parseCurlToRequest(curl);
  expect(parsedCurl.url).toBeTruthy();

  const execution = await executeCurl(curl);

  return { curl, parsed: parsedCurl, matchedUrl, confidence: llmResult.confidence, execution };
}

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------
interface E2EResult {
  name: string;
  passed: boolean;
  matchedUrl: string;
  confidence: number;
  httpStatus: number;
  error?: string;
}

const results: E2EResult[] = [];

afterAll(() => {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log('\n');
  console.log('='.repeat(90));
  console.log('  E2E EXPANDED API TEST SUMMARY');
  console.log('='.repeat(90));
  console.log(`  Total: ${results.length}  |  Passed: ${passed}  |  Failed: ${failed}`);
  console.log('-'.repeat(90));

  for (const r of results) {
    const icon = r.passed ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${r.name}`);
    console.log(`         URL: ${r.matchedUrl}`);
    console.log(`         HTTP: ${r.httpStatus}  |  Confidence: ${(r.confidence * 100).toFixed(0)}%`);
    if (r.error) console.log(`         Error: ${r.error}`);
    console.log('');
  }
  console.log('='.repeat(90));
});

// =========================================================================
// Suite 8: Government / Science APIs
// =========================================================================
describe('Suite 8: Government / Science APIs', () => {

  test('USGS Earthquake API — find recent earthquake data', async () => {
    const entries = [
      ...noiseEntries(),
      makeEntry({
        method: 'GET',
        url: 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2024-01-01&endtime=2024-01-02&minmagnitude=4',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"type":"FeatureCollection","metadata":{"generated":1704240000000,"url":"...","title":"USGS Earthquakes","status":200,"api":"1.14.1","count":5},"features":[{"type":"Feature","properties":{"mag":4.5,"place":"10km SW of Tokyo","time":1704153600000},"geometry":{"type":"Point","coordinates":[139.69,35.68,10]}}]}',
      }),
      makeEntry({
        method: 'GET',
        url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"type":"FeatureCollection","features":[]}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Find the API that queries earthquake data with magnitude and date filters.');

    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('type', 'FeatureCollection');
    expect(body).toHaveProperty('metadata');
    expect(body.metadata).toHaveProperty('status', 200);

    results.push({ name: 'USGS Earthquake: query with filters', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });

  test('NASA APOD — astronomy picture of the day', async () => {
    const entries = [
      ...noiseEntries(),
      makeEntry({
        method: 'GET',
        url: 'https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"date":"2024-01-15","explanation":"A beautiful nebula...","hdurl":"https://apod.nasa.gov/apod/image/2401/nebula.jpg","media_type":"image","title":"Cosmic Nebula","url":"https://apod.nasa.gov/apod/image/2401/nebula_small.jpg"}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Get the NASA astronomy picture of the day API.');

    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('title');
    expect(body).toHaveProperty('url');
    expect(body).toHaveProperty('media_type');

    results.push({ name: 'NASA APOD: picture of the day', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });
});

// =========================================================================
// Suite 9: Weather APIs
// =========================================================================
describe('Suite 9: Weather APIs', () => {

  test('Open-Meteo — get weather forecast for San Francisco', async () => {
    const entries = [
      ...noiseEntries(),
      makeEntry({
        method: 'GET',
        url: 'https://api.open-meteo.com/v1/forecast?latitude=37.7749&longitude=-122.4194&current_weather=true&hourly=temperature_2m',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"latitude":37.78,"longitude":-122.42,"current_weather":{"temperature":15.2,"windspeed":12.5,"winddirection":280,"weathercode":3,"time":"2024-01-15T10:00"},"hourly":{"time":["2024-01-15T00:00"],"temperature_2m":[12.5]}}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Find the weather forecast API for San Francisco.');

    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('latitude');
    expect(body).toHaveProperty('longitude');
    expect(body).toHaveProperty('current_weather');
    expect(body.current_weather).toHaveProperty('temperature');

    results.push({ name: 'Open-Meteo: SF weather forecast', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });

  test('Open-Meteo — get historical weather data', async () => {
    const entries = [
      ...noiseEntries(),
      makeEntry({
        method: 'GET',
        url: 'https://archive-api.open-meteo.com/v1/archive?latitude=40.7128&longitude=-74.006&start_date=2024-01-01&end_date=2024-01-07&daily=temperature_2m_max,temperature_2m_min',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"latitude":40.71,"longitude":-74.01,"daily":{"time":["2024-01-01"],"temperature_2m_max":[5.2],"temperature_2m_min":[-1.3]}}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Get the historical weather archive API for New York.');

    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('daily');
    expect(body.daily).toHaveProperty('time');

    results.push({ name: 'Open-Meteo: NYC historical weather', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });
});

// =========================================================================
// Suite 10: Culture / Art APIs
// =========================================================================
describe('Suite 10: Culture / Art APIs', () => {

  test('Met Museum — get artwork details', async () => {
    const entries = [
      ...noiseEntries(),
      makeEntry({
        method: 'GET',
        url: 'https://collectionapi.metmuseum.org/public/collection/v1/objects/45734',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"objectID":45734,"isHighlight":true,"primaryImage":"https://images.metmuseum.org/CRDImages/as/original/DP251139.jpg","department":"Asian Art","objectName":"Hanging scroll","title":"Quail and Millet","artistDisplayName":"Kiyohara Yukinobu","medium":"Ink and color on silk"}',
      }),
      makeEntry({
        method: 'GET',
        url: 'https://collectionapi.metmuseum.org/public/collection/v1/search?q=sunflowers',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"total":12,"objectIDs":[436524,437980]}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Find the API that gets the details for a specific artwork object at the Met Museum.');

    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('objectID', 45734);
    expect(body).toHaveProperty('title');
    expect(body).toHaveProperty('department');

    results.push({ name: 'Met Museum: artwork details', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });

  test('Met Museum — search artworks', async () => {
    const entries = [
      ...noiseEntries(),
      makeEntry({
        method: 'GET',
        url: 'https://collectionapi.metmuseum.org/public/collection/v1/search?q=van+gogh&hasImages=true',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"total":224,"objectIDs":[436532,436529,436528]}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Find the Met Museum API that searches for artworks.');

    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('objectIDs');
    expect(body.total).toBeGreaterThan(0);

    results.push({ name: 'Met Museum: search artworks', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });
});

// =========================================================================
// Suite 11: News / Social APIs
// =========================================================================
describe('Suite 11: News / Social APIs', () => {

  test('Hacker News — get top stories', async () => {
    const entries = [
      ...noiseEntries(),
      makeEntry({
        method: 'GET',
        url: 'https://hacker-news.firebaseio.com/v0/topstories.json',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '[41234567,41234568,41234569,41234570,41234571]',
      }),
      makeEntry({
        method: 'GET',
        url: 'https://hacker-news.firebaseio.com/v0/item/41234567.json',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"by":"pg","descendants":15,"id":41234567,"kids":[41234600],"score":100,"time":1704067200,"title":"Show HN: Something cool","type":"story","url":"https://example.com"}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Find the API that fetches the list of top stories from Hacker News.');

    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(typeof body[0]).toBe('number');

    results.push({ name: 'Hacker News: top stories', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });

  test('Hacker News — get single item details', async () => {
    // Use an isolated HAR to avoid LLM confusion between topstories and item endpoints
    const entries = [
      ...noiseEntries(),
      makeEntry({
        method: 'GET',
        url: 'https://hacker-news.firebaseio.com/v0/item/1.json',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"by":"pg","descendants":15,"id":1,"kids":[15,234509],"score":57,"time":1160418111,"title":"Y Combinator","type":"story","url":"http://ycombinator.com"}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Get the API that fetches details for a single Hacker News story item.');

    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('title');
    expect(body).toHaveProperty('type');

    results.push({ name: 'Hacker News: single item', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });

  test('Dog CEO — get random dog images', async () => {
    const entries = [
      ...noiseEntries(),
      makeEntry({
        method: 'GET',
        url: 'https://dog.ceo/api/breeds/image/random/3',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"message":["https://images.dog.ceo/breeds/retriever-golden/n02099601_1.jpg","https://images.dog.ceo/breeds/husky/n02110185_1.jpg","https://images.dog.ceo/breeds/poodle-standard/n02113799_1.jpg"],"status":"success"}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Find the API that gets random dog images.');

    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('status', 'success');
    expect(body).toHaveProperty('message');
    expect(Array.isArray(body.message)).toBe(true);
    expect(body.message.length).toBe(3);

    results.push({ name: 'Dog CEO: random dog images', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });
});

// =========================================================================
// Suite 12: Finance APIs
// =========================================================================
describe('Suite 12: Finance APIs', () => {

  test('CoinGecko — get Bitcoin price', async () => {
    const entries = [
      ...noiseEntries(),
      makeEntry({
        method: 'GET',
        url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"bitcoin":{"usd":42500,"eur":38900}}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Find the API that gets the current Bitcoin price in USD and EUR.');

    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('bitcoin');
    expect(body.bitcoin).toHaveProperty('usd');
    expect(typeof body.bitcoin.usd).toBe('number');

    results.push({ name: 'CoinGecko: Bitcoin price', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });

  test('Exchange Rate API — get USD exchange rates', async () => {
    const entries = [
      ...noiseEntries(),
      makeEntry({
        method: 'GET',
        url: 'https://api.exchangerate-api.com/v4/latest/USD',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"provider":"https://www.exchangerate-api.com","base":"USD","date":"2024-01-15","rates":{"EUR":0.92,"GBP":0.79,"JPY":148.5}}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Find the API that gets currency exchange rates for USD.');

    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('base', 'USD');
    expect(body).toHaveProperty('rates');
    expect(body.rates).toHaveProperty('EUR');
    expect(typeof body.rates.EUR).toBe('number');

    results.push({ name: 'Exchange Rate: USD rates', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });
});

// =========================================================================
// Suite 13: Gaming / Entertainment APIs
// =========================================================================
describe('Suite 13: Gaming / Entertainment APIs', () => {

  test('PokeAPI — get Pokemon list', async () => {
    const entries = [
      ...noiseEntries(),
      makeEntry({
        method: 'GET',
        url: 'https://pokeapi.co/api/v2/pokemon?limit=5',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"count":1302,"next":"https://pokeapi.co/api/v2/pokemon?offset=5&limit=5","results":[{"name":"bulbasaur","url":"https://pokeapi.co/api/v2/pokemon/1/"},{"name":"ivysaur","url":"https://pokeapi.co/api/v2/pokemon/2/"}]}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Find the API that lists Pokemon.');

    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('count');
    expect(body).toHaveProperty('results');
    expect(body.results.length).toBe(5);
    expect(body.results[0]).toHaveProperty('name', 'bulbasaur');

    results.push({ name: 'PokeAPI: list Pokemon', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });

  test('PokeAPI — get specific Pokemon details', async () => {
    const entries = [
      ...noiseEntries(),
      makeEntry({
        method: 'GET',
        url: 'https://pokeapi.co/api/v2/pokemon/pikachu',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"id":25,"name":"pikachu","base_experience":112,"height":4,"weight":60,"types":[{"slot":1,"type":{"name":"electric"}}],"abilities":[{"ability":{"name":"static"}}]}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Get the API that fetches details about Pikachu.');

    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('name', 'pikachu');
    expect(body).toHaveProperty('id', 25);
    expect(body).toHaveProperty('types');

    results.push({ name: 'PokeAPI: Pikachu details', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });

  test('Rick and Morty — get characters', async () => {
    const entries = [
      ...noiseEntries(),
      makeEntry({
        method: 'GET',
        url: 'https://rickandmortyapi.com/api/character?page=1',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"info":{"count":826,"pages":42,"next":"https://rickandmortyapi.com/api/character?page=2"},"results":[{"id":1,"name":"Rick Sanchez","status":"Alive","species":"Human"},{"id":2,"name":"Morty Smith","status":"Alive","species":"Human"}]}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Find the API that lists Rick and Morty characters.');

    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('info');
    expect(body.info).toHaveProperty('count');
    expect(body).toHaveProperty('results');
    expect(body.results[0]).toHaveProperty('name', 'Rick Sanchez');

    results.push({ name: 'Rick and Morty: character list', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });
});

// =========================================================================
// Suite 14: User Data APIs
// =========================================================================
describe('Suite 14: User Data APIs', () => {

  test('Random User — generate random users', async () => {
    const entries = [
      ...noiseEntries(),
      makeEntry({
        method: 'GET',
        url: 'https://randomuser.me/api/?results=3&nat=us',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"results":[{"gender":"female","name":{"title":"Ms","first":"Jane","last":"Doe"},"email":"jane@example.com","login":{"username":"bigbird123"},"location":{"city":"Springfield"}}],"info":{"results":3,"page":1}}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Find the API that generates random user data.');

    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('results');
    expect(body.results.length).toBe(3);
    expect(body.results[0]).toHaveProperty('name');
    expect(body.results[0]).toHaveProperty('email');
    expect(body).toHaveProperty('info');

    results.push({ name: 'Random User: generate users', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });
});

// =========================================================================
// Suite 15: Mixed realistic scenarios — multi-API HAR files
// =========================================================================
describe('Suite 15: Mixed multi-API scenarios', () => {

  test('Travel research page — pick the weather API from weather + flight + hotel noise', async () => {
    const entries = [
      ...noiseEntries(),
      // Flight API (noise for this test)
      makeEntry({
        method: 'GET',
        url: 'https://api.skyscanner.net/apiservices/v3/flights/live/search/create',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"status":"RESULT_STATUS_COMPLETE","content":{"results":{}}}',
      }),
      // Weather API (the target)
      makeEntry({
        method: 'GET',
        url: 'https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Asia/Tokyo',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"latitude":35.68,"longitude":139.65,"daily":{"time":["2024-06-15"],"temperature_2m_max":[28.5],"temperature_2m_min":[21.2],"precipitation_sum":[2.1]}}',
      }),
      // Hotel API (noise for this test)
      makeEntry({
        method: 'GET',
        url: 'https://api.booking.com/v1/hotels/search?dest_id=Tokyo&checkin=2024-06-15',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"result":[{"hotel_name":"Park Hyatt","price":450}]}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Find the weather forecast API for Tokyo.');

    expect(result.matchedUrl).toContain('open-meteo.com');
    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('daily');

    results.push({ name: 'Mixed: weather from travel page', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });

  test('Dashboard page — pick the earthquake API from analytics + map + earthquake noise', async () => {
    const entries = [
      ...noiseEntries(),
      // Google Maps tiles (noise)
      makeEntry({
        method: 'GET',
        url: 'https://maps.googleapis.com/maps/api/js?key=AIzaSyFake&libraries=visualization',
        status: 200,
        responseMimeType: 'application/javascript',
        responseBody: '// google maps js',
      }),
      // Target: earthquake query
      makeEntry({
        method: 'GET',
        url: 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2024-01-01&endtime=2024-01-31&minmagnitude=5',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"type":"FeatureCollection","metadata":{"generated":1706745600000,"status":200,"count":23},"features":[{"properties":{"mag":5.2,"place":"South of Fiji"}}]}',
      }),
      // GeoNames API (noise)
      makeEntry({
        method: 'GET',
        url: 'https://api.geonames.org/countryInfoJSON?username=demo',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"geonames":[{"countryName":"Japan","countryCode":"JP"}]}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Find the earthquake data API with magnitude filter.');

    expect(result.matchedUrl).toContain('earthquake.usgs.gov');
    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body.type).toBe('FeatureCollection');

    results.push({ name: 'Mixed: earthquake from dashboard', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });

  test('Crypto dashboard — pick exchange rates from crypto + exchange rate APIs', async () => {
    const entries = [
      ...noiseEntries(),
      // CoinGecko (noise for this test)
      makeEntry({
        method: 'GET',
        url: 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '[{"id":"bitcoin","symbol":"btc","current_price":42500}]',
      }),
      // Target: exchange rates
      makeEntry({
        method: 'GET',
        url: 'https://api.exchangerate-api.com/v4/latest/USD',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"base":"USD","rates":{"EUR":0.92,"GBP":0.79,"JPY":148.5,"BTC":0.000023}}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Find the fiat currency exchange rate API for USD.');

    expect(result.matchedUrl).toContain('exchangerate-api.com');
    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('rates');
    expect(body.rates).toHaveProperty('EUR');

    results.push({ name: 'Mixed: exchange rates from crypto dashboard', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });

  test('Science news page — pick NASA APOD from HN + NASA + dog API noise', async () => {
    const entries = [
      ...noiseEntries(),
      // HN stories (noise)
      makeEntry({
        method: 'GET',
        url: 'https://hacker-news.firebaseio.com/v0/topstories.json',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '[41234567,41234568]',
      }),
      // Dog CEO (noise)
      makeEntry({
        method: 'GET',
        url: 'https://dog.ceo/api/breeds/list/all',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"message":{"affenpinscher":[],"bulldog":[]},"status":"success"}',
      }),
      // Target: NASA APOD
      makeEntry({
        method: 'GET',
        url: 'https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY',
        status: 200,
        responseMimeType: 'application/json',
        responseBody: '{"title":"Horsehead Nebula","explanation":"One of the most identifiable nebulae.","url":"https://apod.nasa.gov/apod/image.jpg","media_type":"image","date":"2024-01-15"}',
      }),
    ];

    const result = await runFullPipeline(entries, 'Find the NASA astronomy picture of the day API.');

    expect(result.matchedUrl).toContain('api.nasa.gov');
    expect(result.execution.status).toBe(200);
    const body = JSON.parse(result.execution.body);
    expect(body).toHaveProperty('title');
    expect(body).toHaveProperty('url');

    results.push({ name: 'Mixed: NASA APOD from science page', passed: true, matchedUrl: result.matchedUrl, confidence: result.confidence, httpStatus: result.execution.status });
  });
});

// =========================================================================
// Suite 16: Record & Replay — expanded APIs
// =========================================================================
describe('Suite 16: Record & Replay — expanded APIs', () => {
  const recordingsDir = path.resolve(__dirname, '..', '..', '..', '..', '__recordings__');

  async function recordOrReplay(
    name: string,
    url: string,
    opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<{ url: string; responseStatus: number; responseBody: string }> {
    const filePath = path.join(recordingsDir, `${name}.json`);

    // Check if recording exists and is fresh (7 days)
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < 7 * 24 * 60 * 60 * 1000) {
        const cached = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return cached;
      }
    }

    // Record fresh
    const fetchOpts: RequestInit = {
      method: opts.method || 'GET',
      headers: opts.headers || { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    };
    if (opts.body) fetchOpts.body = opts.body;

    const res = await fetch(url, fetchOpts);
    const body = await res.text();

    const recording = { url, responseStatus: res.status, responseBody: body };

    if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(recording, null, 2));

    return recording;
  }

  test('Record Open-Meteo — weather forecast replay', async () => {
    const recording = await recordOrReplay(
      'open-meteo-forecast',
      'https://api.open-meteo.com/v1/forecast?latitude=37.7749&longitude=-122.4194&current_weather=true',
    );

    const entry = makeEntry({
      method: 'GET',
      url: recording.url,
      status: recording.responseStatus,
      responseBody: recording.responseBody,
    });

    const curl = harToCurl.generateCurl(entry);
    const execution = await executeCurl(curl);

    expect(execution.status).toBe(200);
    const body = JSON.parse(execution.body);
    expect(body).toHaveProperty('current_weather');

    results.push({ name: 'Record/Replay: Open-Meteo forecast', passed: true, matchedUrl: recording.url, confidence: 1.0, httpStatus: execution.status });
  });

  test('Record PokeAPI — Pokemon detail replay', async () => {
    const recording = await recordOrReplay(
      'pokeapi-pikachu',
      'https://pokeapi.co/api/v2/pokemon/pikachu',
    );

    const entry = makeEntry({
      method: 'GET',
      url: recording.url,
      status: recording.responseStatus,
      responseBody: recording.responseBody,
    });

    const curl = harToCurl.generateCurl(entry);
    const execution = await executeCurl(curl);

    expect(execution.status).toBe(200);
    const body = JSON.parse(execution.body);
    expect(body).toHaveProperty('name', 'pikachu');

    results.push({ name: 'Record/Replay: PokeAPI Pikachu', passed: true, matchedUrl: recording.url, confidence: 1.0, httpStatus: execution.status });
  });

  test('Record USGS Earthquake — query replay', async () => {
    const recording = await recordOrReplay(
      'usgs-earthquake-query',
      'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2024-01-01&endtime=2024-01-02&minmagnitude=4',
    );

    const entry = makeEntry({
      method: 'GET',
      url: recording.url,
      status: recording.responseStatus,
      responseBody: recording.responseBody,
    });

    const curl = harToCurl.generateCurl(entry);
    const execution = await executeCurl(curl);

    expect(execution.status).toBe(200);
    const body = JSON.parse(execution.body);
    expect(body).toHaveProperty('type', 'FeatureCollection');

    results.push({ name: 'Record/Replay: USGS Earthquake query', passed: true, matchedUrl: recording.url, confidence: 1.0, httpStatus: execution.status });
  });

  test('Record CoinGecko — Bitcoin price replay', async () => {
    const recording = await recordOrReplay(
      'coingecko-bitcoin-price',
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    );

    const entry = makeEntry({
      method: 'GET',
      url: recording.url,
      status: recording.responseStatus,
      responseBody: recording.responseBody,
    });

    const curl = harToCurl.generateCurl(entry);
    const execution = await executeCurl(curl);

    expect(execution.status).toBe(200);
    const body = JSON.parse(execution.body);
    expect(body).toHaveProperty('bitcoin');

    results.push({ name: 'Record/Replay: CoinGecko Bitcoin', passed: true, matchedUrl: recording.url, confidence: 1.0, httpStatus: execution.status });
  });

  test('Record Rick and Morty — character list replay', async () => {
    const recording = await recordOrReplay(
      'rickandmorty-characters',
      'https://rickandmortyapi.com/api/character?page=1',
    );

    const entry = makeEntry({
      method: 'GET',
      url: recording.url,
      status: recording.responseStatus,
      responseBody: recording.responseBody,
    });

    const curl = harToCurl.generateCurl(entry);
    const execution = await executeCurl(curl);

    expect(execution.status).toBe(200);
    const body = JSON.parse(execution.body);
    expect(body).toHaveProperty('results');
    expect(body.results[0]).toHaveProperty('name');

    results.push({ name: 'Record/Replay: Rick and Morty characters', passed: true, matchedUrl: recording.url, confidence: 1.0, httpStatus: execution.status });
  });
});
