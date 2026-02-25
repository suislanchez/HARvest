/**
 * Stress / Load Simulation Tests
 *
 * Simulates what a company tester would do: throw lots of HARs at the system,
 * test concurrency, large files, rapid requests, and edge cases.
 *
 * Run with:
 *   cd backend && npx jest e2e-stress --testTimeout=300000 --verbose
 */

import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AnalysisService } from './analysis.service';
import { HarParserService } from './har-parser.service';
import { HarToCurlService } from './har-to-curl.service';
import { OpenaiService } from '../openai/openai.service';
import { ConfigService } from '@nestjs/config';

const apiKey = process.env.OPENAI_API_KEY;
const describeIf = apiKey ? describe : describe.skip;

describeIf('E2E Stress — Concurrent / Load / Edge Cases', () => {
  let app: INestApplication;
  let service: AnalysisService;

  const fixturesDir = path.resolve(__dirname, '../../../../test-fixtures');
  const capturedDir = path.join(fixturesDir, 'captured');

  beforeAll(async () => {
    // Set up both direct service access AND HTTP server
    const harParser = new HarParserService();
    const harToCurl = new HarToCurlService();
    const configService = {
      get: (key: string) => {
        if (key === 'OPENAI_API_KEY') return apiKey;
        if (key === 'OPENAI_MODEL') return process.env.OPENAI_MODEL || 'gpt-4o-mini';
        return undefined;
      },
    } as unknown as ConfigService;
    const openai = new OpenaiService(configService);
    service = new AnalysisService(harParser, harToCurl, openai);

    // HTTP server for upload tests
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(APP_GUARD)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Helper: find all available HAR files
  // ---------------------------------------------------------------------------
  function findAvailableHars(): Array<{ path: string; name: string; size: number }> {
    const hars: Array<{ path: string; name: string; size: number }> = [];

    // Fixed test fixtures
    const fixedFiles = ['jokes-real.har', 'sfgate.har', 'recipescal.har', 'ecommerce.har', 'graphql-app.har'];
    for (const f of fixedFiles) {
      const p = path.join(fixturesDir, f);
      if (fs.existsSync(p)) {
        hars.push({ path: p, name: f, size: fs.statSync(p).size });
      }
    }

    // Captured HARs
    if (fs.existsSync(capturedDir)) {
      const captured = fs.readdirSync(capturedDir).filter((f) => f.endsWith('.har'));
      for (const f of captured) {
        const p = path.join(capturedDir, f);
        hars.push({ path: p, name: `captured/${f}`, size: fs.statSync(p).size });
      }
    }

    return hars;
  }

  // ---------------------------------------------------------------------------
  // 1. Concurrent pipeline execution
  // ---------------------------------------------------------------------------
  describe('Concurrent uploads', () => {
    it('5 HARs analyzed in parallel via service.analyzeHar()', async () => {
      const hars = findAvailableHars().slice(0, 5);
      if (hars.length < 2) {
        console.log('  Skipping — need at least 2 HAR files');
        return;
      }

      console.log(`  Running ${hars.length} concurrent analyzeHar() calls...`);
      const start = Date.now();

      const promises = hars.map((har) => {
        const buffer = fs.readFileSync(har.path);
        return service
          .analyzeHar(buffer, 'Find the main API endpoint')
          .then((result) => ({ har: har.name, result, error: null }))
          .catch((error) => ({ har: har.name, result: null, error }));
      });

      const outcomes = await Promise.all(promises);
      const elapsed = Date.now() - start;

      const succeeded = outcomes.filter((o) => o.result !== null);
      const failed = outcomes.filter((o) => o.error !== null);

      console.log(`  Completed in ${(elapsed / 1000).toFixed(1)}s — ${succeeded.length} succeeded, ${failed.length} failed`);

      for (const o of outcomes) {
        if (o.result) {
          console.log(`    [OK] ${o.har} → ${o.result.matchedRequest.url} (${(o.result.confidence * 100).toFixed(0)}%)`);
        } else {
          console.log(`    [ERR] ${o.har} → ${(o.error as Error).message}`);
        }
      }

      // At least 80% should succeed
      expect(succeeded.length).toBeGreaterThanOrEqual(Math.floor(hars.length * 0.8));

      // Each successful result should have valid shape
      for (const o of succeeded) {
        expect(o.result!.curl).toBeTruthy();
        expect(o.result!.curl.startsWith('curl')).toBe(true);
        expect(o.result!.confidence).toBeGreaterThan(0);
        expect(o.result!.stats.totalRequests).toBeGreaterThan(0);
      }
    }, 180_000);

    it('3 concurrent HTTP uploads via POST /api/analyze', async () => {
      const hars = findAvailableHars().slice(0, 3);
      if (hars.length < 2) {
        console.log('  Skipping — need at least 2 HAR files');
        return;
      }

      console.log(`  Running ${hars.length} concurrent HTTP uploads...`);
      const start = Date.now();

      const promises = hars.map((har) =>
        request(app.getHttpServer())
          .post('/api/analyze')
          .attach('file', har.path)
          .field('description', 'Find the main API endpoint')
          .then((res) => ({ har: har.name, status: res.status, body: res.body, error: null }))
          .catch((error) => ({ har: har.name, status: 0, body: null, error })),
      );

      const outcomes = await Promise.all(promises);
      const elapsed = Date.now() - start;

      const succeeded = outcomes.filter((o) => o.status === 201);
      console.log(`  Completed in ${(elapsed / 1000).toFixed(1)}s — ${succeeded.length}/${outcomes.length} returned 201`);

      for (const o of outcomes) {
        if (o.status === 201) {
          console.log(`    [201] ${o.har} → ${o.body.matchedRequest.url}`);
        } else {
          console.log(`    [${o.status}] ${o.har} → ${o.error?.message || JSON.stringify(o.body).slice(0, 100)}`);
        }
      }

      // At least 2 should succeed
      expect(succeeded.length).toBeGreaterThanOrEqual(2);
    }, 180_000);
  });

  // ---------------------------------------------------------------------------
  // 2. Large HAR file handling
  // ---------------------------------------------------------------------------
  describe('Large file handling', () => {
    it('jokes-large.har (87MB+) via service.analyzeHar()', async () => {
      const harPath = path.join(fixturesDir, 'jokes-large.har');
      if (!fs.existsSync(harPath)) {
        console.log('  Skipping — jokes-large.har not found');
        return;
      }

      const stats = fs.statSync(harPath);
      console.log(`  Processing ${(stats.size / 1024 / 1024).toFixed(1)}MB HAR...`);

      const buffer = fs.readFileSync(harPath);
      const start = Date.now();
      const result = await service.analyzeHar(buffer, 'give me a curl to get jokes');
      const elapsed = Date.now() - start;

      console.log(`  Completed in ${(elapsed / 1000).toFixed(1)}s`);
      console.log(`    Entries: ${result.stats.filteredRequests}/${result.stats.totalRequests}`);
      console.log(`    URL: ${result.matchedRequest.url}`);

      expect(result.curl).toContain('jokeapi.dev');
      expect(result.matchedRequest.url).toContain('jokeapi.dev');
    }, 120_000);

    it('HAR with 500+ synthetic entries via service.analyzeHar()', async () => {
      // Generate a HAR with many entries to test filtering performance
      const entries = [];
      for (let i = 0; i < 500; i++) {
        entries.push({
          startedDateTime: new Date(Date.now() - i * 100).toISOString(),
          time: Math.random() * 500,
          request: {
            method: 'GET',
            url: i === 250
              ? 'https://api.weather.example.com/v1/forecast?city=NYC'  // The needle
              : `https://cdn.example.com/static/chunk-${i}.js`,        // Hay
            httpVersion: 'HTTP/2.0',
            cookies: [],
            headers: [
              { name: 'Accept', value: i === 250 ? 'application/json' : '*/*' },
              ...(i % 10 === 0
                ? [{ name: 'Content-Type', value: 'application/json' }]
                : []),
            ],
            queryString: [],
            headersSize: -1,
            bodySize: -1,
          },
          response: {
            status: 200,
            statusText: 'OK',
            httpVersion: 'HTTP/2.0',
            cookies: [],
            headers: [
              {
                name: 'Content-Type',
                value: i === 250 ? 'application/json' : 'application/javascript',
              },
            ],
            content: {
              size: i === 250 ? 1024 : 50000,
              mimeType: i === 250 ? 'application/json' : 'application/javascript',
            },
            redirectURL: '',
            headersSize: -1,
            bodySize: i === 250 ? 1024 : 50000,
          },
          cache: {},
          timings: { send: 0, wait: 50, receive: 50 },
        });
      }

      // Add some API-like endpoints in the noise
      const apiEndpoints = [
        'https://analytics.example.com/collect',
        'https://api.example.com/v2/users/me',
        'https://api.example.com/v2/notifications',
        'https://tracking.example.com/pixel',
      ];
      for (const url of apiEndpoints) {
        entries.push({
          startedDateTime: new Date().toISOString(),
          time: 100,
          request: {
            method: 'GET',
            url,
            httpVersion: 'HTTP/2.0',
            cookies: [],
            headers: [{ name: 'Accept', value: 'application/json' }],
            queryString: [],
            headersSize: -1,
            bodySize: -1,
          },
          response: {
            status: 200,
            statusText: 'OK',
            httpVersion: 'HTTP/2.0',
            cookies: [],
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            content: { size: 200, mimeType: 'application/json' },
            redirectURL: '',
            headersSize: -1,
            bodySize: 200,
          },
          cache: {},
          timings: { send: 0, wait: 50, receive: 50 },
        });
      }

      const har = {
        log: {
          version: '1.2',
          creator: { name: 'stress-test', version: '1.0' },
          entries,
        },
      };

      const buffer = Buffer.from(JSON.stringify(har));
      console.log(`  Generated HAR: ${entries.length} entries, ${(buffer.length / 1024).toFixed(1)}KB`);

      const start = Date.now();
      const result = await service.analyzeHar(buffer, 'Find the weather forecast API');
      const elapsed = Date.now() - start;

      console.log(`  Completed in ${(elapsed / 1000).toFixed(1)}s`);
      console.log(`    Filtered: ${result.stats.filteredRequests}/${result.stats.totalRequests}`);
      console.log(`    Matched: ${result.matchedRequest.url}`);

      // Should have filtered out most of the static JS files
      expect(result.stats.filteredRequests).toBeLessThan(result.stats.totalRequests);
      expect(result.curl).toBeTruthy();
      // The weather API should be among the matches
      expect(result.matchedRequest.url).toContain('api');
    }, 120_000);
  });

  // ---------------------------------------------------------------------------
  // 3. Rapid sequential uploads (rate limit behavior)
  // ---------------------------------------------------------------------------
  describe('Rapid sequential requests', () => {
    it('5 rapid sequential HTTP uploads process correctly', async () => {
      const harPath = path.join(fixturesDir, 'jokes-real.har');
      if (!fs.existsSync(harPath)) return;

      const descriptions = [
        'Find the jokes API',
        'Get the API that returns jokes',
        'Which endpoint fetches humor data',
        'Reverse engineer the joke service',
        'Find the REST API for jokes',
      ];

      console.log(`  Sending ${descriptions.length} rapid sequential requests...`);
      const allStart = Date.now();

      const outcomes: Array<{ desc: string; status: number; elapsed: number; url?: string }> = [];

      for (const desc of descriptions) {
        const start = Date.now();
        const res = await request(app.getHttpServer())
          .post('/api/analyze')
          .attach('file', harPath)
          .field('description', desc);
        const elapsed = Date.now() - start;

        outcomes.push({
          desc,
          status: res.status,
          elapsed,
          url: res.body?.matchedRequest?.url,
        });
      }

      const totalElapsed = Date.now() - allStart;
      const succeeded = outcomes.filter((o) => o.status === 201);

      console.log(`  Total: ${(totalElapsed / 1000).toFixed(1)}s for ${outcomes.length} requests`);
      for (const o of outcomes) {
        console.log(`    [${o.status}] "${o.desc.slice(0, 40)}" → ${(o.elapsed / 1000).toFixed(1)}s${o.url ? ` → ${o.url}` : ''}`);
      }

      // All should succeed (throttler is disabled)
      expect(succeeded.length).toBe(descriptions.length);

      // All should find the same API
      for (const o of succeeded) {
        expect(o.url).toContain('jokeapi.dev');
      }
    }, 300_000);
  });

  // ---------------------------------------------------------------------------
  // 4. Edge cases and malformed input
  // ---------------------------------------------------------------------------
  describe('Edge cases', () => {
    it('HAR with zero entries → error', async () => {
      const emptyHar = {
        log: {
          version: '1.2',
          creator: { name: 'test', version: '1.0' },
          entries: [],
        },
      };

      const buffer = Buffer.from(JSON.stringify(emptyHar));
      await expect(
        service.analyzeHar(buffer, 'find something'),
      ).rejects.toThrow();
    });

    it('HAR with only image/css/font entries → meaningful error', async () => {
      const staticHar = {
        log: {
          version: '1.2',
          creator: { name: 'test', version: '1.0' },
          entries: [
            makeStaticEntry('https://cdn.example.com/style.css', 'text/css'),
            makeStaticEntry('https://cdn.example.com/logo.png', 'image/png'),
            makeStaticEntry('https://cdn.example.com/font.woff2', 'font/woff2'),
            makeStaticEntry('https://cdn.example.com/bg.svg', 'image/svg+xml'),
          ],
        },
      };

      const buffer = Buffer.from(JSON.stringify(staticHar));
      await expect(
        service.analyzeHar(buffer, 'find the API'),
      ).rejects.toThrow(/No API requests found/);
    });

    it('HAR with a single API entry → still works', async () => {
      const singleHar = {
        log: {
          version: '1.2',
          creator: { name: 'test', version: '1.0' },
          entries: [
            {
              startedDateTime: '2024-01-01T00:00:00.000Z',
              time: 100,
              request: {
                method: 'GET',
                url: 'https://api.example.com/v1/users',
                httpVersion: 'HTTP/2.0',
                cookies: [],
                headers: [{ name: 'Accept', value: 'application/json' }],
                queryString: [],
                headersSize: -1,
                bodySize: -1,
              },
              response: {
                status: 200,
                statusText: 'OK',
                httpVersion: 'HTTP/2.0',
                cookies: [],
                headers: [{ name: 'Content-Type', value: 'application/json' }],
                content: { size: 100, mimeType: 'application/json' },
                redirectURL: '',
                headersSize: -1,
                bodySize: 100,
              },
              cache: {},
              timings: { send: 0, wait: 50, receive: 50 },
            },
          ],
        },
      };

      const buffer = Buffer.from(JSON.stringify(singleHar));
      const result = await service.analyzeHar(buffer, 'find the users API');

      expect(result.matchedRequest.url).toBe('https://api.example.com/v1/users');
      expect(result.curl).toContain('api.example.com/v1/users');
      expect(result.stats.filteredRequests).toBe(1);
    }, 60_000);

    it('Very long description is handled gracefully', async () => {
      const harPath = path.join(fixturesDir, 'jokes-real.har');
      if (!fs.existsSync(harPath)) return;

      const longDesc = 'Find the jokes API. '.repeat(200); // ~4000 chars
      const buffer = fs.readFileSync(harPath);
      const result = await service.analyzeHar(buffer, longDesc);

      expect(result.curl).toContain('jokeapi.dev');
    }, 60_000);

    it('Unicode description is handled gracefully', async () => {
      const harPath = path.join(fixturesDir, 'jokes-real.har');
      if (!fs.existsSync(harPath)) return;

      const buffer = fs.readFileSync(harPath);
      const result = await service.analyzeHar(buffer, 'Encontrar la API de chistes (jokes) 🃏 APIを見つける');

      expect(result.curl).toBeTruthy();
      expect(result.matchedRequest.url).toBeTruthy();
    }, 60_000);

    it('HTTP upload with empty HAR entries → 400 or 500 with message', async () => {
      const emptyHar = {
        log: {
          version: '1.2',
          creator: { name: 'test', version: '1.0' },
          entries: [],
        },
      };

      const res = await request(app.getHttpServer())
        .post('/api/analyze')
        .attach('file', Buffer.from(JSON.stringify(emptyHar)), 'empty.har')
        .field('description', 'find something');

      // Should be a 4xx or 5xx with an error message
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Consistency check: same input → same output
  // ---------------------------------------------------------------------------
  describe('Consistency', () => {
    it('Same HAR + same description → same matched URL (3 runs)', async () => {
      const harPath = path.join(fixturesDir, 'jokes-real.har');
      if (!fs.existsSync(harPath)) return;

      const buffer = fs.readFileSync(harPath);
      const description = 'give me a curl to get 5 jokes';

      const urls: string[] = [];
      for (let i = 0; i < 3; i++) {
        const result = await service.analyzeHar(buffer, description);
        urls.push(result.matchedRequest.url);
      }

      console.log(`  Run URLs: ${urls.join(' | ')}`);

      // All 3 runs should pick the same URL
      expect(urls[0]).toBe(urls[1]);
      expect(urls[1]).toBe(urls[2]);
    }, 180_000);
  });

  // ---------------------------------------------------------------------------
  // Helper
  // ---------------------------------------------------------------------------
  function makeStaticEntry(url: string, mimeType: string) {
    return {
      startedDateTime: '2024-01-01T00:00:00.000Z',
      time: 50,
      request: {
        method: 'GET',
        url,
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
        headers: [{ name: 'Content-Type', value: mimeType }],
        content: { size: 1000, mimeType },
        redirectURL: '',
        headersSize: -1,
        bodySize: 1000,
      },
      cache: {},
      timings: { send: 0, wait: 25, receive: 25 },
    };
  }
});
