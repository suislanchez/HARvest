import { Page } from '@playwright/test';

export const MOCK_ANALYSIS_RESPONSE = {
  curl: "curl -X GET 'https://api.example.com/v1/users?page=1' -H 'Accept: application/json' -H 'Authorization: Bearer test-token-123'",
  matchedRequest: {
    method: 'GET',
    url: 'https://api.example.com/v1/users?page=1',
    status: 200,
    contentType: 'application/json',
  },
  confidence: 0.92,
  reason: 'Best match for user list API endpoint with pagination support',
  topMatches: [
    {
      index: 0,
      confidence: 0.92,
      reason: 'User list endpoint with pagination',
      method: 'GET',
      url: 'https://api.example.com/v1/users?page=1',
    },
    {
      index: 4,
      confidence: 0.65,
      reason: 'Posts endpoint also returns paginated JSON',
      method: 'GET',
      url: 'https://api.example.com/v1/posts?page=1&limit=10',
    },
    {
      index: 1,
      confidence: 0.3,
      reason: 'Login endpoint returns JSON but is auth-related',
      method: 'POST',
      url: 'https://api.example.com/v1/auth/login',
    },
  ],
  stats: {
    totalRequests: 5,
    filteredRequests: 3,
    uniqueRequests: 3,
    promptTokens: 520,
    completionTokens: 180,
    cost: 0.0012,
    processingTime: { total: 1450, parsing: 45, llm: 1350 },
  },
  allRequests: [
    { method: 'GET', url: 'https://api.example.com/v1/users?page=1', status: 200, contentType: 'application/json', time: 120 },
    { method: 'POST', url: 'https://api.example.com/v1/auth/login', status: 200, contentType: 'application/json', time: 200 },
    { method: 'GET', url: 'https://cdn.example.com/assets/style.css', status: 200, contentType: 'text/css', time: 50 },
    { method: 'GET', url: 'https://www.google-analytics.com/collect?v=1&tid=UA-000000', status: 204, contentType: '', time: 30 },
    { method: 'GET', url: 'https://api.example.com/v1/posts?page=1&limit=10', status: 200, contentType: 'application/json', time: 95 },
  ],
};

export const MOCK_PROXY_RESPONSE = {
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': 'application/json', 'x-request-id': 'test-123' },
  body: '{"users":[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}],"total":42}',
  duration: 145,
};

/**
 * Intercept POST http://localhost:3001/api/analyze and return a mock response.
 * The frontend makes a cross-origin fetch to the backend, so page.route() can catch it.
 */
export async function mockAnalyzeEndpoint(page: Page, response = MOCK_ANALYSIS_RESPONSE) {
  await page.route('http://localhost:3001/api/analyze', async (route) => {
    // Small delay to let pipeline stepper animate
    await new Promise((r) => setTimeout(r, 800));
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

/**
 * Intercept the frontend proxy endpoint for curl execution.
 */
export async function mockProxyEndpoint(page: Page, response = MOCK_PROXY_RESPONSE) {
  await page.route('**/api/proxy', async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}
