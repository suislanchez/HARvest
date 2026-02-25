/**
 * HTTP-Level Integration Tests
 *
 * Spins up the actual NestJS HTTP server and tests the full request path:
 *   Multipart upload → Controller → AnalysisService → OpenAI → curl gen
 *
 * Then executes the returned curl against live APIs.
 *
 * Run with:
 *   cd backend && npx jest e2e-http --testTimeout=120000 --verbose
 */

import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { ThrottlerGuard } from '@nestjs/throttler';
import { HarToCurlService } from './har-to-curl.service';

// Skip entire suite if no API key (these hit real OpenAI)
const apiKey = process.env.OPENAI_API_KEY;
const describeIf = apiKey ? describe : describe.skip;

describeIf('E2E HTTP — Multipart Upload → Real Pipeline → Execute', () => {
  let app: INestApplication;
  let harToCurl: HarToCurlService;

  const fixturesDir = path.resolve(__dirname, '../../../../test-fixtures');
  const capturedDir = path.join(fixturesDir, 'captured');

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Disable throttler so tests aren't rate-limited
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix('api');
    await app.init();

    harToCurl = new HarToCurlService();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Helper: execute curl from response
  // ---------------------------------------------------------------------------
  async function executeCurl(curl: string): Promise<{ status: number; body: any }> {
    const parsed = harToCurl.parseCurlToRequest(curl);
    const res = await fetch(parsed.url, {
      method: parsed.method,
      headers: parsed.headers,
      body: parsed.body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body };
  }

  // ---------------------------------------------------------------------------
  // Results tracking
  // ---------------------------------------------------------------------------
  interface HttpResult {
    name: string;
    httpStatus: number;
    matchedUrl: string;
    confidence: number;
    curlExecuted: boolean;
    curlStatus?: number;
    durationMs: number;
  }

  const results: HttpResult[] = [];

  // ---------------------------------------------------------------------------
  // Section 1: Real HAR file upload + execution
  // ---------------------------------------------------------------------------
  describe('Upload real HAR files via HTTP', () => {
    it('POST /api/analyze with jokes-real.har → 201 + valid curl + execute', async () => {
      const harPath = path.join(fixturesDir, 'jokes-real.har');
      if (!fs.existsSync(harPath)) return;

      const start = Date.now();
      const res = await request(app.getHttpServer())
        .post('/api/analyze')
        .attach('file', harPath)
        .field('description', 'give me a curl to get 5 jokes from the API')
        .expect(201);
      const elapsed = Date.now() - start;

      // Validate response shape
      expect(res.body).toHaveProperty('curl');
      expect(res.body).toHaveProperty('matchedRequest');
      expect(res.body).toHaveProperty('confidence');
      expect(res.body).toHaveProperty('reason');
      expect(res.body).toHaveProperty('topMatches');
      expect(res.body).toHaveProperty('stats');
      expect(res.body).toHaveProperty('allRequests');

      expect(res.body.curl).toContain('jokeapi.dev');
      expect(res.body.matchedRequest.url).toContain('jokeapi.dev');
      expect(res.body.confidence).toBeGreaterThanOrEqual(0.7);

      // Stats shape
      expect(res.body.stats).toHaveProperty('totalRequests');
      expect(res.body.stats).toHaveProperty('filteredRequests');
      expect(res.body.stats).toHaveProperty('promptTokens');
      expect(res.body.stats).toHaveProperty('processingTime');
      expect(res.body.stats.processingTime).toHaveProperty('total');
      expect(res.body.stats.processingTime).toHaveProperty('parsing');
      expect(res.body.stats.processingTime).toHaveProperty('llm');

      // Execute the returned curl
      const exec = await executeCurl(res.body.curl);
      expect(exec.status).toBe(200);
      expect(exec.body).toHaveProperty('jokes');
      expect(exec.body.jokes.length).toBe(5);

      results.push({
        name: 'jokes-real.har (HTTP)',
        httpStatus: res.status,
        matchedUrl: res.body.matchedRequest.url,
        confidence: res.body.confidence,
        curlExecuted: true,
        curlStatus: exec.status,
        durationMs: elapsed,
      });
    }, 90_000);

    it('POST /api/analyze with sfgate.har → 201 + weather curl + execute', async () => {
      const harPath = path.join(fixturesDir, 'sfgate.har');
      if (!fs.existsSync(harPath)) return;

      const start = Date.now();
      const res = await request(app.getHttpServer())
        .post('/api/analyze')
        .attach('file', harPath)
        .field('description', 'Return the API that fetches the weather of San Francisco')
        .expect(201);
      const elapsed = Date.now() - start;

      expect(res.body.curl).toContain('forecast7.com');
      expect(res.body.matchedRequest.url).toContain('forecast7.com');

      // Execute
      const exec = await executeCurl(res.body.curl);
      expect(exec.status).toBe(200);

      results.push({
        name: 'sfgate.har (HTTP)',
        httpStatus: res.status,
        matchedUrl: res.body.matchedRequest.url,
        confidence: res.body.confidence,
        curlExecuted: true,
        curlStatus: exec.status,
        durationMs: elapsed,
      });
    }, 90_000);

    it('POST /api/analyze with recipescal.har → 201 + recipe API', async () => {
      const harPath = path.join(fixturesDir, 'recipescal.har');
      if (!fs.existsSync(harPath)) return;

      const start = Date.now();
      const res = await request(app.getHttpServer())
        .post('/api/analyze')
        .attach('file', harPath)
        .field('description', 'reverse engineer the API that gives me recipes')
        .expect(201);
      const elapsed = Date.now() - start;

      expect(res.body.matchedRequest.url).toContain('recipescal.com');
      expect(res.body.matchedRequest.method).toBe('POST');

      results.push({
        name: 'recipescal.har (HTTP)',
        httpStatus: res.status,
        matchedUrl: res.body.matchedRequest.url,
        confidence: res.body.confidence,
        curlExecuted: false,
        durationMs: elapsed,
      });
    }, 90_000);
  });

  // ---------------------------------------------------------------------------
  // Section 2: Captured browser HARs via HTTP (if available)
  // ---------------------------------------------------------------------------
  describe('Upload captured browser HARs via HTTP', () => {
    const capturedTests = [
      {
        filename: 'open-meteo-weather.har',
        description: 'Find the weather forecast API',
        expectedUrlContains: 'open-meteo',
        canExecute: true,
      },
      {
        filename: 'usgs-earthquakes.har',
        description: 'Find the earthquake data API',
        expectedUrlContains: 'earthquake.usgs.gov',
        canExecute: true,
      },
      {
        filename: 'jsonplaceholder-todos.har',
        description: 'Find the REST API that fetches data',
        expectedUrlContains: 'jsonplaceholder',
        canExecute: true,
      },
    ];

    for (const tc of capturedTests) {
      it(`${tc.filename}: upload → analyze → ${tc.canExecute ? 'execute' : 'validate'}`, async () => {
        const harPath = path.join(capturedDir, tc.filename);
        if (!fs.existsSync(harPath)) {
          console.log(`  Skipping ${tc.filename} — run capture-real-hars.ts first`);
          return;
        }

        const start = Date.now();
        const res = await request(app.getHttpServer())
          .post('/api/analyze')
          .attach('file', harPath)
          .field('description', tc.description)
          .expect(201);
        const elapsed = Date.now() - start;

        expect(res.body.matchedRequest.url.toLowerCase()).toContain(tc.expectedUrlContains);
        expect(res.body.confidence).toBeGreaterThanOrEqual(0.3);

        let curlStatus: number | undefined;
        if (tc.canExecute) {
          const exec = await executeCurl(res.body.curl);
          curlStatus = exec.status;
          expect(exec.status).toBe(200);
        }

        results.push({
          name: `${tc.filename} (HTTP)`,
          httpStatus: res.status,
          matchedUrl: res.body.matchedRequest.url,
          confidence: res.body.confidence,
          curlExecuted: tc.canExecute,
          curlStatus,
          durationMs: elapsed,
        });
      }, 90_000);
    }
  });

  // ---------------------------------------------------------------------------
  // Section 3: HTTP error handling
  // ---------------------------------------------------------------------------
  describe('HTTP error cases', () => {
    it('POST /api/analyze without file → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/analyze')
        .field('description', 'find something')
        .expect(400);
    });

    it('POST /api/analyze with description too short → 400', async () => {
      const harPath = path.join(fixturesDir, 'jokes-real.har');
      if (!fs.existsSync(harPath)) return;

      await request(app.getHttpServer())
        .post('/api/analyze')
        .attach('file', harPath)
        .field('description', 'hi')
        .expect(400);
    });

    it('POST /api/analyze with invalid JSON file → error', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/analyze')
        .attach('file', Buffer.from('not json {{{'), 'bad.har')
        .field('description', 'find the API');

      // Should be 400 (bad request) or 500 (internal server error)
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(201);
    });

    it('POST /api/analyze with non-.har extension → error', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/analyze')
        .attach('file', Buffer.from('hello'), 'test.txt')
        .field('description', 'find the API');

      // Should reject with 400 (file filter) or other error
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(201);
    });
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  afterAll(() => {
    if (results.length === 0) return;

    console.log('\n');
    console.log('='.repeat(100));
    console.log('  E2E HTTP INTEGRATION RESULTS');
    console.log('='.repeat(100));

    for (const r of results) {
      const exec = r.curlExecuted ? ` → curl HTTP ${r.curlStatus}` : '';
      console.log(`  [HTTP ${r.httpStatus}] ${r.name}`);
      console.log(`           URL: ${r.matchedUrl}  |  Confidence: ${(r.confidence * 100).toFixed(0)}%  |  Time: ${(r.durationMs / 1000).toFixed(1)}s${exec}`);
    }

    console.log('='.repeat(100));
  });
});
