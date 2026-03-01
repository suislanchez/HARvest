import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { GroqService } from '../groq/groq.service';
import { ThrottlerGuard } from '@nestjs/throttler';

describe('AnalysisController (integration)', () => {
  let app: INestApplication;

  const mockOpenaiService = {
    identifyApiRequest: jest.fn().mockResolvedValue({
      matchIndex: 0,
      confidence: 0.95,
      reason: 'Best match',
      topMatches: [
        { index: 0, confidence: 0.95, reason: 'Best match' },
      ],
    }),
  };

  function makeHarBuffer(): Buffer {
    return Buffer.from(JSON.stringify({
      log: {
        version: '1.2',
        creator: { name: 'test', version: '1.0' },
        entries: [
          {
            startedDateTime: '2024-01-01T00:00:00.000Z',
            time: 100,
            request: {
              method: 'GET',
              url: 'https://api.example.com/users',
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
              headers: [{ name: 'Content-Type', value: 'application/json' }],
              content: { size: 50, mimeType: 'application/json' },
              redirectURL: '',
              headersSize: -1,
              bodySize: 50,
            },
            cache: {},
            timings: { send: 0, wait: 50, receive: 50 },
          },
        ],
      },
    }));
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GroqService)
      .useValue(mockOpenaiService)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/analyze with valid HAR + description returns 201 with expected fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', makeHarBuffer(), 'test.har')
      .field('description', 'Find the users API')
      .expect(201);

    expect(res.body).toHaveProperty('curl');
    expect(res.body).toHaveProperty('matchedRequest');
    expect(res.body).toHaveProperty('confidence');
    expect(res.body).toHaveProperty('topMatches');
    expect(res.body).toHaveProperty('stats');
    expect(res.body).toHaveProperty('allRequests');
    expect(res.body.matchedRequest).toHaveProperty('method');
    expect(res.body.matchedRequest).toHaveProperty('url');
    expect(res.body.curl).toContain('https://api.example.com/users');
  });

  it('POST /api/analyze with no file returns 400', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .field('description', 'Find the users API')
      .expect(400);
  });

  it('POST /api/analyze with short description (< 5 chars) returns 400', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', makeHarBuffer(), 'test.har')
      .field('description', 'ab')
      .expect(400);
  });

  it('POST /api/analyze with .txt file returns 400', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', Buffer.from('not a har'), 'test.txt')
      .field('description', 'Find the users API')
      .expect(400);
  });

  it('POST /api/analyze response body has correct shape', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/analyze')
      .attach('file', makeHarBuffer(), 'test.har')
      .field('description', 'Find the users API')
      .expect(201);

    expect(typeof res.body.curl).toBe('string');
    expect(typeof res.body.confidence).toBe('number');
    expect(Array.isArray(res.body.topMatches)).toBe(true);
    expect(Array.isArray(res.body.allRequests)).toBe(true);
    expect(typeof res.body.stats.totalRequests).toBe('number');
    expect(typeof res.body.stats.filteredRequests).toBe('number');
    expect(typeof res.body.stats.tokenEstimate).toBe('number');
  });
});
