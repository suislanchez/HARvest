#!/usr/bin/env node
/**
 * Generates comprehensive stress-test HAR fixtures.
 * Run: node test-fixtures/generate-fixtures.js
 */

const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = __dirname;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let ts = new Date('2026-02-24T10:00:00.000Z').getTime();
function nextTime(ms = 50) {
  ts += ms;
  return new Date(ts).toISOString();
}

function entry(method, url, opts = {}) {
  const {
    status = 200,
    reqHeaders = [],
    resMimeType = 'application/json',
    resText = '',
    resSize = 0,
    postData = null,
    time = 150,
  } = opts;
  const e = {
    startedDateTime: nextTime(Math.random() * 100 | 0),
    time,
    request: {
      method,
      url,
      httpVersion: 'HTTP/2.0',
      cookies: [],
      headers: [{ name: 'User-Agent', value: 'Mozilla/5.0' }, ...reqHeaders],
      queryString: [],
      headersSize: 200,
      bodySize: postData ? JSON.stringify(postData).length : 0,
    },
    response: {
      status,
      statusText: status === 200 ? 'OK' : status === 204 ? 'No Content' : status === 301 ? 'Moved' : status === 302 ? 'Found' : status === 101 ? 'Switching Protocols' : '',
      httpVersion: 'HTTP/2.0',
      cookies: [],
      headers: [{ name: 'Content-Type', value: resMimeType }],
      content: { size: resSize || resText.length || 0, mimeType: resMimeType, ...(resText ? { text: resText } : {}) },
      redirectURL: '',
      headersSize: 120,
      bodySize: resSize || resText.length || 0,
    },
    cache: {},
    timings: { send: 1, wait: time - 10, receive: 9 },
  };
  if (postData) {
    e.request.postData = { mimeType: 'application/json', text: typeof postData === 'string' ? postData : JSON.stringify(postData) };
  }
  return e;
}

function staticAsset(url, mime = 'application/javascript') {
  return entry('GET', url, { resMimeType: mime, resSize: 50000 + (Math.random() * 200000 | 0), time: 30 + (Math.random() * 50 | 0) });
}

function analytics(url, method = 'POST', mime = 'text/html') {
  return entry(method, url, { status: 204, resMimeType: mime, time: 60 + (Math.random() * 60 | 0) });
}

function authHeaders(type = 'Bearer') {
  return [
    { name: 'Authorization', value: `${type} eyJhbGciOiJSUzI1NiJ9.fake.token` },
    { name: 'Accept', value: 'application/json' },
  ];
}

function har(title, entries) {
  return { log: { version: '1.2', creator: { name: 'Chrome DevTools', version: '121.0' }, pages: [{ startedDateTime: '2026-02-24T10:00:00.000Z', id: 'page_1', title, pageTimings: { onContentLoad: 1200, onLoad: 2500 } }], entries } };
}

// ---------------------------------------------------------------------------
// FIXTURE 1: SPA Dashboard (80+ entries)
// ---------------------------------------------------------------------------
function genSpaDashboard() {
  ts = new Date('2026-02-24T10:00:00.000Z').getTime();
  const entries = [];

  // 25 static assets
  for (let i = 0; i < 8; i++) entries.push(staticAsset(`https://app.dashboard.example.com/static/js/chunk.${i}abc${i}d.js`));
  for (let i = 0; i < 4; i++) entries.push(staticAsset(`https://app.dashboard.example.com/static/css/module.${i}ef.css`, 'text/css'));
  for (let i = 0; i < 3; i++) entries.push(staticAsset(`https://app.dashboard.example.com/static/js/chunk.${i}abc${i}d.js.map`, 'application/json'));
  entries.push(staticAsset('https://app.dashboard.example.com/favicon.ico', 'image/x-icon'));
  entries.push(staticAsset('https://app.dashboard.example.com/manifest.json', 'application/json'));
  for (let i = 0; i < 5; i++) entries.push(staticAsset(`https://app.dashboard.example.com/static/icons/icon-${i}.svg`, 'image/svg+xml'));
  entries.push(staticAsset('https://app.dashboard.example.com/service-worker.js'));
  entries.push(staticAsset('https://app.dashboard.example.com/static/img/logo.png', 'image/png'));
  entries.push(staticAsset('https://app.dashboard.example.com/static/img/bg.webp', 'image/webp'));

  // 8 analytics/tracking
  entries.push(analytics('https://www.google-analytics.com/g/collect?v=2&tid=G-DASH123'));
  entries.push(analytics('https://cdn.segment.com/v1/projects/abc/settings', 'GET', 'application/json'));
  entries.push(analytics('https://api.segment.io/v1/t', 'POST', 'text/plain'));
  entries.push(analytics('https://api.amplitude.com/2/httpapi', 'POST'));
  entries.push(analytics('https://script.hotjar.com/modules.js', 'GET', 'application/javascript'));
  entries.push(analytics('https://browser.sentry-cdn.com/7.92.0/bundle.min.js', 'GET', 'application/javascript'));
  entries.push(analytics('https://browser-intake-datadoghq.com/api/v2/rum', 'POST'));
  entries.push(analytics('https://widget.intercom.io/widget/abc123', 'GET', 'application/javascript'));

  // 5 CDN
  entries.push(staticAsset('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.min.js'));
  entries.push(staticAsset('https://unpkg.com/react@18.2.0/umd/react.production.min.js'));
  entries.push(staticAsset('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap', 'text/css'));
  entries.push(staticAsset('https://fonts.gstatic.com/s/inter/v13/UcC73FwrK3iLTcviYwY.woff2', 'font/woff2'));
  entries.push(staticAsset('https://cdn.jsdelivr.net/npm/d3@7.8.5/dist/d3.min.js'));

  // 3 HTML docs
  entries.push(entry('GET', 'https://app.dashboard.example.com/', { resMimeType: 'text/html', resSize: 15000, time: 80 }));
  entries.push(entry('GET', 'https://app.dashboard.example.com/embed/widget', { resMimeType: 'text/html', resSize: 5000, time: 40 }));
  entries.push(entry('GET', 'https://app.dashboard.example.com/sw.html', { resMimeType: 'text/html', resSize: 800, time: 20 }));

  // 2 OPTIONS
  entries.push(entry('OPTIONS', 'https://api.dashboard.example.com/api/v2/metrics/timeseries', { status: 204, time: 10 }));
  entries.push(entry('OPTIONS', 'https://api.dashboard.example.com/api/v2/alerts', { status: 204, time: 10 }));

  // 1 WebSocket, 1 failed, 1 redirect
  entries.push(entry('GET', 'wss://ws.dashboard.example.com/realtime', { status: 101, resMimeType: '', time: 5 }));
  entries.push(entry('GET', 'https://api.dashboard.example.com/api/v2/ws-fallback', { status: 0, resMimeType: '', time: 0 }));
  entries.push(entry('GET', 'https://app.dashboard.example.com/old-page', { status: 302, resMimeType: '', time: 5 }));

  // LaunchDarkly
  entries.push(entry('GET', 'https://app.launchdarkly.com/sdk/evalx/contexts', { resMimeType: 'application/json', resText: '{"flags":{}}', time: 80 }));

  // TARGET APIs
  entries.push(entry('GET', 'https://api.dashboard.example.com/api/v2/metrics/timeseries?metric=cpu.usage&from=1708700000&to=1708790000&step=60', {
    reqHeaders: authHeaders(),
    resText: '{"series":[{"metric":"cpu.usage","timestamps":[1708700000,1708700060],"values":[42.5,45.2],"tags":{"host":"web-01"}}]}',
    resSize: 12000, time: 320,
  }));
  entries.push(entry('GET', 'https://api.dashboard.example.com/api/v2/metrics/timeseries?metric=memory.used&from=1708700000&to=1708790000&step=60', {
    reqHeaders: authHeaders(),
    resText: '{"series":[{"metric":"memory.used","timestamps":[1708700000,1708700060],"values":[8200,8350],"tags":{"host":"web-01"}}]}',
    resSize: 12000, time: 290,
  }));
  entries.push(entry('GET', 'https://api.dashboard.example.com/api/v2/alerts?status=active&severity=critical', {
    reqHeaders: authHeaders(),
    resText: '{"alerts":[{"id":"alt_001","severity":"critical","title":"High CPU on web-03","triggered":"2026-02-24T09:45:00Z","status":"active"}]}',
    resSize: 2400, time: 180,
  }));
  entries.push(entry('GET', 'https://api.dashboard.example.com/api/v2/dashboards/d_8827', {
    reqHeaders: authHeaders(),
    resText: '{"id":"d_8827","title":"Production Overview","widgets":[{"id":"w1","type":"timeseries","query":"avg:cpu.usage{*}"},{"id":"w2","type":"value","query":"sum:errors{*}"}]}',
    resSize: 3200, time: 200,
  }));
  entries.push(entry('POST', 'https://api.dashboard.example.com/api/v2/dashboards/d_8827/widgets', {
    reqHeaders: authHeaders(),
    postData: { type: 'timeseries', title: 'CPU Usage', query: 'avg:cpu.usage{host:web-*}', visualization: { yAxis: { min: 0, max: 100 } } },
    resText: '{"id":"w3","type":"timeseries","title":"CPU Usage","created":"2026-02-24T10:05:00Z"}',
    time: 250,
  }));
  entries.push(entry('GET', 'https://api.dashboard.example.com/api/v2/users/me', {
    reqHeaders: authHeaders(),
    resText: '{"id":"u_001","email":"admin@example.com","name":"Admin User","role":"admin","org":"Acme Corp"}',
    time: 120,
  }));
  entries.push(entry('POST', 'https://api.dashboard.example.com/api/v2/search', {
    reqHeaders: authHeaders(),
    postData: { query: 'error rate', scope: 'metrics', limit: 10 },
    resText: '{"results":[{"name":"error.rate","type":"metric","description":"HTTP 5xx error rate"},{"name":"error.count","type":"metric"}]}',
    time: 280,
  }));
  entries.push(entry('GET', 'https://api.dashboard.example.com/api/v2/teams', {
    reqHeaders: authHeaders(),
    resText: '{"teams":[{"id":"t_001","name":"Platform","members":12},{"id":"t_002","name":"Frontend","members":8}]}',
    time: 140,
  }));
  entries.push(entry('GET', 'https://api.dashboard.example.com/api/v2/integrations', {
    reqHeaders: authHeaders(),
    resText: '{"integrations":[{"id":"int_001","name":"Slack","status":"active"},{"id":"int_002","name":"PagerDuty","status":"active"},{"id":"int_003","name":"Jira","status":"pending"}]}',
    time: 160,
  }));
  entries.push(entry('POST', 'https://api.dashboard.example.com/api/v2/graphql', {
    reqHeaders: authHeaders(),
    postData: { operationName: 'GetServiceMap', query: 'query GetServiceMap($env: String!) { serviceMap(env: $env) { services { name dependencies latency errorRate } } }', variables: { env: 'production' } },
    resText: '{"data":{"serviceMap":{"services":[{"name":"api-gateway","dependencies":["auth-service","user-service"],"latency":45,"errorRate":0.02}]}}}',
    time: 350,
  }));
  // Near-misses
  entries.push(entry('GET', 'https://api.dashboard.example.com/api/v2/health', {
    resText: '{"status":"healthy","uptime":864000}', time: 30,
  }));
  entries.push(entry('GET', 'https://api.dashboard.example.com/api/v2/config', {
    resText: '{"refreshInterval":30,"maxWidgets":20,"version":"3.2.1"}', time: 50,
  }));

  return har('Monitoring Dashboard', entries);
}

// ---------------------------------------------------------------------------
// FIXTURE 2: Streaming Platform (50 entries)
// ---------------------------------------------------------------------------
function genStreamingPlatform() {
  ts = new Date('2026-02-24T11:00:00.000Z').getTime();
  const entries = [];

  // 12 static
  for (let i = 0; i < 5; i++) entries.push(staticAsset(`https://app.stream.example.com/static/js/player.${i}.js`));
  for (let i = 0; i < 3; i++) entries.push(staticAsset(`https://app.stream.example.com/static/css/app.${i}.css`, 'text/css'));
  for (let i = 0; i < 4; i++) entries.push(staticAsset(`https://images.stream.example.com/thumbnails/t${i}.jpg`, 'image/jpeg'));

  // 5 analytics
  entries.push(analytics('https://www.google-analytics.com/g/collect?v=2&tid=G-STREAM123'));
  entries.push(analytics('https://cdn.mxpnl.com/libs/mixpanel.min.js', 'GET', 'application/javascript'));
  entries.push(analytics('https://sb.scorecardresearch.com/beacon.js', 'GET', 'application/javascript'));
  entries.push(entry('POST', 'https://telemetry.stream.example.com/v1/events', { status: 204, postData: { events: [{ type: 'page_view' }] }, time: 40 }));
  entries.push(analytics('https://secure-us.imrworldwide.com/cgi-bin/gn', 'GET', 'image/gif'));

  // HTML
  entries.push(entry('GET', 'https://app.stream.example.com/', { resMimeType: 'text/html', resSize: 20000, time: 100 }));

  // TARGET APIs
  entries.push(entry('GET', 'https://api.stream.example.com/api/v3/catalog/search?q=breaking+bad&type=series&page=1', {
    reqHeaders: authHeaders(),
    resText: '{"results":[{"id":"tt_8827","title":"Breaking Bad","type":"series","year":2008,"rating":9.5,"poster":"https://images.stream.example.com/posters/tt_8827.jpg"}],"total":1,"page":1}',
    resSize: 4500, time: 280,
  }));
  entries.push(entry('GET', 'https://api.stream.example.com/api/v3/catalog/titles/tt_8827', {
    reqHeaders: authHeaders(),
    resText: '{"id":"tt_8827","title":"Breaking Bad","synopsis":"A chemistry teacher diagnosed with cancer turns to making meth.","cast":[{"name":"Bryan Cranston","role":"Walter White"},{"name":"Aaron Paul","role":"Jesse Pinkman"}],"rating":9.5,"seasons":5,"genre":["drama","crime","thriller"]}',
    resSize: 8000, time: 200,
  }));
  entries.push(entry('GET', 'https://api.stream.example.com/api/v3/catalog/titles/tt_8827/episodes?season=1', {
    reqHeaders: authHeaders(),
    resText: '{"episodes":[{"id":"ep_001","title":"Pilot","number":1,"duration":3480,"synopsis":"Walter White begins his transformation."},{"id":"ep_002","title":"Cat\'s in the Bag...","number":2,"duration":2880}],"season":1,"total":7}',
    resSize: 5000, time: 220,
  }));
  entries.push(entry('POST', 'https://api.stream.example.com/api/v3/playback/start', {
    reqHeaders: authHeaders(),
    postData: { titleId: 'tt_8827', episodeId: 'ep_001', quality: 'auto', deviceId: 'dev_abc123' },
    resText: '{"playbackUrl":"https://cdn.stream.example.com/hls/tt_8827/ep_001/master.m3u8","token":"playback_token_xyz","drmLicenseUrl":"https://drm.stream.example.com/license","subtitles":[{"lang":"en","url":"https://cdn.stream.example.com/subs/tt_8827/ep_001/en.vtt"}]}',
    time: 350,
  }));
  entries.push(entry('POST', 'https://api.stream.example.com/api/v3/user/watchlist', {
    reqHeaders: authHeaders(),
    postData: { titleId: 'tt_8827', action: 'add' },
    resText: '{"success":true,"watchlistCount":15}',
    time: 150,
  }));
  entries.push(entry('GET', 'https://api.stream.example.com/api/v3/user/profile', {
    reqHeaders: authHeaders(),
    resText: '{"id":"u_456","name":"John","email":"john@example.com","plan":"premium","profiles":[{"id":"p1","name":"John","avatar":"default"}]}',
    time: 130,
  }));
  entries.push(entry('GET', 'https://api.stream.example.com/api/v3/recommendations?genre=drama&limit=20', {
    reqHeaders: authHeaders(),
    resText: '{"recommendations":[{"id":"tt_9001","title":"Better Call Saul","match":95},{"id":"tt_9002","title":"Ozark","match":88},{"id":"tt_9003","title":"Narcos","match":82}]}',
    resSize: 6000, time: 300,
  }));
  entries.push(entry('POST', 'https://api.stream.example.com/api/v3/analytics/event', {
    reqHeaders: authHeaders(),
    postData: { event: 'play_start', titleId: 'tt_8827', episodeId: 'ep_001', position: 0, quality: '1080p' },
    resText: '{"ok":true}',
    time: 60,
  }));
  entries.push(entry('GET', 'https://api.stream.example.com/api/v3/catalog/genres', {
    reqHeaders: authHeaders(),
    resText: '{"genres":["action","comedy","drama","horror","sci-fi","documentary","thriller","romance","animation"]}',
    time: 100,
  }));

  // Media manifests (should NOT be filtered — they're interesting)
  entries.push(entry('GET', 'https://cdn.stream.example.com/manifest/tt_8827.mpd', {
    resMimeType: 'application/dash+xml',
    resText: '<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"><Period><AdaptationSet mimeType="video/mp4"><Representation bandwidth="5000000" width="1920" height="1080"/></AdaptationSet></Period></MPD>',
    resSize: 2000, time: 80,
  }));
  entries.push(entry('GET', 'https://cdn.stream.example.com/manifest/tt_8827.m3u8', {
    resMimeType: 'application/vnd.apple.mpegurl',
    resText: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\nhttps://cdn.stream.example.com/hls/tt_8827/1080p.m3u8',
    resSize: 500, time: 60,
  }));
  entries.push(entry('POST', 'https://drm.stream.example.com/license', {
    resMimeType: 'application/octet-stream', resSize: 1024, time: 200,
  }));

  // More noise
  for (let i = 0; i < 6; i++) entries.push(staticAsset(`https://app.stream.example.com/static/js/vendor.${i}.js`));
  entries.push(entry('GET', 'https://www.googletagmanager.com/gtag/js?id=G-STREAM123', { resMimeType: 'application/javascript', resSize: 90000, time: 70 }));

  return har('Streaming Platform', entries);
}

// ---------------------------------------------------------------------------
// FIXTURE 3: Fintech Banking (45 entries)
// ---------------------------------------------------------------------------
function genFintechBanking() {
  ts = new Date('2026-02-24T12:00:00.000Z').getTime();
  const entries = [];

  // 10 static
  for (let i = 0; i < 5; i++) entries.push(staticAsset(`https://app.bank.example.com/static/js/bundle.${i}.js`));
  for (let i = 0; i < 3; i++) entries.push(staticAsset(`https://app.bank.example.com/static/css/styles.${i}.css`, 'text/css'));
  entries.push(staticAsset('https://app.bank.example.com/static/img/logo.svg', 'image/svg+xml'));
  entries.push(staticAsset('https://app.bank.example.com/static/fonts/inter.woff2', 'font/woff2'));

  // 4 analytics
  entries.push(analytics('https://www.google-analytics.com/g/collect?v=2&tid=G-BANK123'));
  entries.push(analytics('https://bat.bing.com/bat.js', 'GET', 'application/javascript'));
  entries.push(analytics('https://browser.sentry-cdn.com/7.92.0/bundle.min.js', 'GET', 'application/javascript'));
  entries.push(analytics('https://js.hs-analytics.net/analytics.js', 'GET', 'application/javascript'));

  // HTML
  entries.push(entry('GET', 'https://app.bank.example.com/', { resMimeType: 'text/html', resSize: 12000, time: 90 }));

  // OAuth
  entries.push(entry('POST', 'https://auth.bank.example.com/oauth/token', {
    resMimeType: 'application/json',
    postData: { grant_type: 'authorization_code', code: 'auth_code_xyz', redirect_uri: 'https://app.bank.example.com/callback' },
    resText: '{"access_token":"eyJhbGciOiJSUzI1NiJ9.bank.token","token_type":"Bearer","expires_in":3600,"refresh_token":"refresh_xyz"}',
    time: 300,
  }));

  // TARGET APIs
  entries.push(entry('GET', 'https://api.bank.example.com/api/v1/accounts', {
    reqHeaders: authHeaders(),
    resText: '{"accounts":[{"id":"acc_001","type":"checking","name":"Main Checking","balance":4521.33,"currency":"USD"},{"id":"acc_002","type":"savings","name":"Emergency Fund","balance":15000.00,"currency":"USD"},{"id":"acc_003","type":"checking","name":"Joint Account","balance":2100.50,"currency":"USD"}]}',
    resSize: 1200, time: 180,
  }));
  entries.push(entry('GET', 'https://api.bank.example.com/api/v1/accounts/acc_001/transactions?from=2026-01-01&to=2026-02-24&page=1&limit=50', {
    reqHeaders: authHeaders(),
    resText: '{"transactions":[{"id":"txn_001","date":"2026-02-23","description":"Whole Foods Market","amount":-85.42,"category":"groceries","type":"debit"},{"id":"txn_002","date":"2026-02-22","description":"Direct Deposit - Acme Corp","amount":3500.00,"category":"income","type":"credit"},{"id":"txn_003","date":"2026-02-21","description":"Netflix","amount":-15.99,"category":"entertainment","type":"debit"}],"page":1,"totalPages":5,"total":243}',
    resSize: 8000, time: 250,
  }));
  entries.push(entry('POST', 'https://api.bank.example.com/api/v1/transfers', {
    reqHeaders: authHeaders(),
    postData: { fromAccount: 'acc_001', toAccount: 'acc_002', amount: 250.00, currency: 'USD', memo: 'Rent payment' },
    resText: '{"transferId":"xfr_001","status":"completed","fromBalance":4271.33,"timestamp":"2026-02-24T12:05:00Z"}',
    time: 400,
  }));
  entries.push(entry('GET', 'https://api.bank.example.com/api/v1/accounts/acc_001/balance', {
    reqHeaders: authHeaders(),
    resText: '{"available":4271.33,"pending":125.00,"currency":"USD","asOf":"2026-02-24T12:05:30Z"}',
    time: 100,
  }));
  entries.push(entry('POST', 'https://api.bank.example.com/api/v1/payments/schedule', {
    reqHeaders: authHeaders(),
    postData: { payeeId: 'payee_001', amount: 89.99, currency: 'USD', date: '2026-03-01', recurring: true, frequency: 'monthly', endDate: null, memo: 'Electric bill' },
    resText: '{"paymentId":"pmt_001","status":"scheduled","nextDate":"2026-03-01","recurring":true,"frequency":"monthly"}',
    time: 300,
  }));
  entries.push(entry('GET', 'https://api.bank.example.com/api/v1/payees', {
    reqHeaders: authHeaders(),
    resText: '{"payees":[{"id":"payee_001","name":"Electric Company","accountEnding":"4521","type":"utility"},{"id":"payee_002","name":"Landlord","accountEnding":"7890","type":"individual"},{"id":"payee_003","name":"Internet Provider","accountEnding":"1234","type":"utility"}]}',
    time: 150,
  }));
  entries.push(entry('GET', 'https://api.bank.example.com/api/v1/cards', {
    reqHeaders: authHeaders(),
    resText: '{"cards":[{"id":"card_001","type":"debit","last4":"4521","status":"active","expiresAt":"2028-06"},{"id":"card_002","type":"credit","last4":"8827","status":"active","limit":10000,"balance":1234.56}]}',
    time: 160,
  }));
  entries.push(entry('POST', 'https://api.bank.example.com/api/v1/cards/card_001/freeze', {
    reqHeaders: authHeaders(),
    postData: { reason: 'lost' },
    resText: '{"cardId":"card_001","status":"frozen","frozenAt":"2026-02-24T12:10:00Z","canUnfreeze":true}',
    time: 200,
  }));
  entries.push(entry('GET', 'https://api.bank.example.com/api/v1/notifications?unread=true', {
    reqHeaders: authHeaders(),
    resText: '{"notifications":[{"id":"n_001","type":"transaction","title":"Large purchase detected","body":"$500+ at Best Buy","read":false,"timestamp":"2026-02-24T09:00:00Z"}],"unreadCount":3}',
    time: 120,
  }));
  entries.push(entry('POST', 'https://api.bank.example.com/api/v1/auth/token/refresh', {
    postData: { refreshToken: 'refresh_xyz' },
    resText: '{"access_token":"eyJhbGciOiJSUzI1NiJ9.new.token","expires_in":3600}',
    time: 100,
  }));

  // Plaid
  entries.push(entry('POST', 'https://api.plaid.com/link/token/create', {
    reqHeaders: [{ name: 'PLAID-CLIENT-ID', value: 'fake_client' }, { name: 'PLAID-SECRET', value: 'fake_secret' }],
    postData: { user: { client_user_id: 'u_001' }, products: ['transactions'], country_codes: ['US'] },
    resText: '{"link_token":"link-sandbox-abc123","expiration":"2026-02-24T14:00:00Z"}',
    time: 350,
  }));

  // More noise
  for (let i = 0; i < 5; i++) entries.push(staticAsset(`https://app.bank.example.com/static/js/vendor.${i}.js`));
  entries.push(entry('GET', 'https://app.bank.example.com/static/img/card-bg.png', { resMimeType: 'image/png', resSize: 30000, time: 25 }));
  entries.push(entry('OPTIONS', 'https://api.bank.example.com/api/v1/transfers', { status: 204, time: 8 }));

  return har('Banking App', entries);
}

// ---------------------------------------------------------------------------
// FIXTURE 4: Travel Booking (60 entries)
// ---------------------------------------------------------------------------
function genTravelBooking() {
  ts = new Date('2026-02-24T13:00:00.000Z').getTime();
  const entries = [];

  // 15 static
  for (let i = 0; i < 8; i++) entries.push(staticAsset(`https://app.travel.example.com/static/js/chunk.${i}.js`));
  for (let i = 0; i < 4; i++) entries.push(staticAsset(`https://app.travel.example.com/static/css/page.${i}.css`, 'text/css'));
  for (let i = 0; i < 3; i++) entries.push(staticAsset(`https://images.travel.example.com/hero/hero-${i}.jpg`, 'image/jpeg'));

  // 6 analytics + ads
  entries.push(analytics('https://www.google-analytics.com/g/collect?v=2&tid=G-TRAVEL123'));
  entries.push(analytics('https://www.googletagmanager.com/gtag/js?id=G-TRAVEL123', 'GET', 'application/javascript'));
  entries.push(analytics('https://snap.licdn.com/li.lms-analytics/insight.min.js', 'GET', 'application/javascript'));
  entries.push(analytics('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'GET', 'application/javascript'));
  entries.push(analytics('https://ad.doubleclick.net/ddm/activity/src=1234', 'GET', 'image/gif'));
  entries.push(analytics('https://analytics.tiktok.com/i18n/pixel/events.js', 'GET', 'application/javascript'));

  // HTML
  entries.push(entry('GET', 'https://app.travel.example.com/', { resMimeType: 'text/html', resSize: 25000, time: 120 }));
  entries.push(entry('GET', 'https://app.travel.example.com/search/results', { resMimeType: 'text/html', resSize: 30000, time: 150 }));

  // TARGET APIs
  entries.push(entry('POST', 'https://api.flights.example.com/v2/search', {
    reqHeaders: [{ name: 'Accept', value: 'application/json' }, { name: 'X-API-Key', value: 'flights_key_abc' }],
    postData: { origin: 'SFO', destination: 'NRT', departDate: '2026-06-15', returnDate: '2026-06-29', passengers: { adults: 2, children: 1 }, cabin: 'economy' },
    resText: '{"flights":[{"id":"FL_8827","airline":"ANA","departure":"2026-06-15T10:30:00","arrival":"2026-06-16T14:30:00","duration":"11h","price":{"amount":1250,"currency":"USD"},"stops":0},{"id":"FL_8828","airline":"JAL","departure":"2026-06-15T13:00:00","price":{"amount":1180,"currency":"USD"},"stops":1}],"total":24}',
    resSize: 15000, time: 800,
  }));
  entries.push(entry('GET', 'https://api.flights.example.com/v2/flights/FL_8827/details', {
    reqHeaders: [{ name: 'X-API-Key', value: 'flights_key_abc' }],
    resText: '{"id":"FL_8827","airline":"ANA","flightNumber":"NH7","aircraft":"Boeing 787-9","departure":{"airport":"SFO","terminal":"I","gate":"G92","time":"2026-06-15T10:30:00"},"arrival":{"airport":"NRT","terminal":"1","time":"2026-06-16T14:30:00"},"amenities":["wifi","meal","entertainment"]}',
    resSize: 5000, time: 300,
  }));
  entries.push(entry('POST', 'https://api.hotels.example.com/v1/search', {
    reqHeaders: [{ name: 'Accept', value: 'application/json' }],
    postData: { city: 'Tokyo', checkIn: '2026-06-15', checkOut: '2026-06-29', rooms: 1, guests: 3 },
    resText: '{"hotels":[{"id":"h_4521","name":"Park Hyatt Tokyo","stars":5,"price":{"amount":450,"currency":"USD","perNight":true},"rating":9.2,"location":{"lat":35.6862,"lng":139.6913}},{"id":"h_4522","name":"Aman Tokyo","stars":5,"price":{"amount":800,"currency":"USD","perNight":true}}],"total":156}',
    resSize: 20000, time: 600,
  }));
  entries.push(entry('GET', 'https://api.hotels.example.com/v1/properties/h_4521/rooms', {
    resText: '{"rooms":[{"type":"deluxe","name":"Deluxe King","price":450,"maxGuests":2,"size":"55sqm","available":3},{"type":"suite","name":"Park Suite","price":900,"maxGuests":4,"size":"100sqm","available":1}],"propertyId":"h_4521"}',
    resSize: 3000, time: 250,
  }));
  entries.push(entry('POST', 'https://api.booking.example.com/v1/reservations', {
    reqHeaders: authHeaders(),
    postData: { flightId: 'FL_8827', hotelId: 'h_4521', roomType: 'deluxe', travelers: [{ name: 'John Doe', passport: 'XX1234567' }, { name: 'Jane Doe', passport: 'XX7654321' }], contactEmail: 'john@example.com' },
    resText: '{"reservationId":"res_001","status":"confirmed","total":{"flights":2500,"hotel":6300,"taxes":880,"currency":"USD","grandTotal":9680},"confirmationCode":"TRVL-8827-XYZ"}',
    time: 500,
  }));
  entries.push(entry('GET', 'https://api.booking.example.com/v1/reservations/res_001', {
    reqHeaders: authHeaders(),
    resText: '{"reservationId":"res_001","status":"confirmed","flights":[{"id":"FL_8827","date":"2026-06-15"}],"hotel":{"id":"h_4521","checkIn":"2026-06-15","checkOut":"2026-06-29"}}',
    time: 200,
  }));
  entries.push(entry('GET', 'https://maps.googleapis.com/maps/api/geocode/json?address=Tokyo&key=AIzaSyFakeKey123', {
    resText: '{"results":[{"formatted_address":"Tokyo, Japan","geometry":{"location":{"lat":35.6762,"lng":139.6503}}}],"status":"OK"}',
    time: 180,
  }));
  entries.push(entry('GET', 'https://api.exchangerate.example.com/v1/rates?base=USD&symbols=JPY', {
    resText: '{"base":"USD","date":"2026-02-24","rates":{"JPY":149.85}}',
    time: 100,
  }));
  entries.push(entry('POST', 'https://api.stripe.com/v1/payment_intents', {
    reqHeaders: [{ name: 'Authorization', value: 'Bearer sk_live_fakeStripeKey' }],
    postData: 'amount=968000&currency=usd&payment_method=pm_card_visa&confirm=true',
    resText: '{"id":"pi_3abc123","status":"succeeded","amount":968000,"currency":"usd"}',
    time: 400,
  }));
  entries.push(entry('GET', 'https://api.booking.example.com/v1/user/trips', {
    reqHeaders: authHeaders(),
    resText: '{"trips":[{"id":"res_001","destination":"Tokyo","dates":"Jun 15-29, 2026","status":"upcoming"},{"id":"res_prev","destination":"Paris","dates":"Dec 20-27, 2025","status":"completed"}],"total":5}',
    time: 150,
  }));

  // More noise
  for (let i = 0; i < 8; i++) entries.push(staticAsset(`https://cdn.travel.example.com/static/js/vendor.${i}.js`));
  entries.push(staticAsset('https://fonts.googleapis.com/css2?family=Roboto', 'text/css'));
  entries.push(staticAsset('https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmSU5fBBc4.woff2', 'font/woff2'));
  entries.push(entry('OPTIONS', 'https://api.flights.example.com/v2/search', { status: 204, time: 8 }));
  entries.push(entry('GET', 'https://app.travel.example.com/old-deals', { status: 301, resMimeType: '', time: 5 }));

  return har('Travel Booking', entries);
}

// ---------------------------------------------------------------------------
// FIXTURE 5: Realtime Collaboration (40 entries)
// ---------------------------------------------------------------------------
function genRealtimeCollab() {
  ts = new Date('2026-02-24T14:00:00.000Z').getTime();
  const entries = [];

  // 10 static
  for (let i = 0; i < 5; i++) entries.push(staticAsset(`https://app.collab.example.com/static/js/editor.${i}.js`));
  for (let i = 0; i < 3; i++) entries.push(staticAsset(`https://app.collab.example.com/static/css/editor.${i}.css`, 'text/css'));
  entries.push(staticAsset('https://app.collab.example.com/static/fonts/monospace.woff2', 'font/woff2'));
  entries.push(staticAsset('https://app.collab.example.com/static/icons/sprite.svg', 'image/svg+xml'));

  // 3 analytics
  entries.push(analytics('https://www.google-analytics.com/g/collect?v=2&tid=G-COLLAB123'));
  entries.push(analytics('https://heapanalytics.com/js/heap-12345.js', 'GET', 'application/javascript'));
  entries.push(analytics('https://rs.fullstory.com/s/fs.js', 'GET', 'application/javascript'));

  // HTML
  entries.push(entry('GET', 'https://app.collab.example.com/', { resMimeType: 'text/html', resSize: 10000, time: 80 }));

  // 2 WebSocket upgrades
  entries.push(entry('GET', 'wss://ws.collab.example.com/doc/doc_8827', { status: 101, resMimeType: '', time: 5 }));
  entries.push(entry('GET', 'wss://ws.collab.example.com/presence', { status: 101, resMimeType: '', time: 5 }));

  // TARGET APIs
  entries.push(entry('GET', 'https://api.collab.example.com/api/v1/workspaces', {
    reqHeaders: authHeaders(),
    resText: '{"workspaces":[{"id":"ws_001","name":"Engineering","memberCount":24},{"id":"ws_002","name":"Design","memberCount":12}]}',
    time: 140,
  }));
  entries.push(entry('GET', 'https://api.collab.example.com/api/v1/workspaces/ws_001/documents', {
    reqHeaders: authHeaders(),
    resText: '{"documents":[{"id":"doc_8827","title":"Q1 Planning","lastEdited":"2026-02-24T13:50:00Z","editors":["Alice","Bob"]},{"id":"doc_8828","title":"API Design Spec","lastEdited":"2026-02-23T18:00:00Z"}],"total":47}',
    time: 180,
  }));
  entries.push(entry('GET', 'https://api.collab.example.com/api/v1/documents/doc_8827', {
    reqHeaders: authHeaders(),
    resText: '{"id":"doc_8827","title":"Q1 Planning","content":{"blocks":[{"id":"b_001","type":"heading","text":"Q1 Objectives"},{"id":"b_002","type":"paragraph","text":"Focus on performance and reliability."}]},"version":42,"collaborators":["Alice","Bob","Charlie"],"createdAt":"2026-01-15T10:00:00Z"}',
    resSize: 15000, time: 200,
  }));
  entries.push(entry('POST', 'https://api.collab.example.com/api/v1/documents/doc_8827/changes', {
    reqHeaders: authHeaders(),
    postData: { operations: [{ type: 'insert', path: [0, 15], text: 'Hello ' }], version: 42, clientId: 'client_abc' },
    resText: '{"version":43,"serverTimestamp":"2026-02-24T14:05:00Z","accepted":true}',
    time: 80,
  }));
  entries.push(entry('POST', 'https://api.collab.example.com/api/v1/documents', {
    reqHeaders: authHeaders(),
    postData: { title: 'Meeting Notes', workspaceId: 'ws_001', template: 'blank' },
    resText: '{"id":"doc_8830","title":"Meeting Notes","workspaceId":"ws_001","version":0,"createdAt":"2026-02-24T14:06:00Z"}',
    time: 200,
  }));
  entries.push(entry('GET', 'https://api.collab.example.com/api/v1/documents/doc_8827/comments', {
    reqHeaders: authHeaders(),
    resText: '{"comments":[{"id":"c_001","author":"Alice","text":"Looks good!","position":{"blockId":"b_001","offset":0},"createdAt":"2026-02-24T13:00:00Z"},{"id":"c_002","author":"Bob","text":"Should we add more detail here?","position":{"blockId":"b_002","offset":10},"resolved":false}]}',
    time: 120,
  }));
  entries.push(entry('POST', 'https://api.collab.example.com/api/v1/documents/doc_8827/comments', {
    reqHeaders: authHeaders(),
    postData: { text: 'Looks good!', position: { blockId: 'b_001', offset: 0 } },
    resText: '{"id":"c_003","author":"Charlie","text":"Looks good!","createdAt":"2026-02-24T14:07:00Z"}',
    time: 100,
  }));
  entries.push(entry('GET', 'https://api.collab.example.com/api/v1/documents/doc_8827/history?limit=20', {
    reqHeaders: authHeaders(),
    resText: '{"versions":[{"version":42,"author":"Bob","timestamp":"2026-02-24T13:50:00Z","summary":"Added objectives section"},{"version":41,"author":"Alice","timestamp":"2026-02-24T12:30:00Z","summary":"Created document"}],"total":42}',
    time: 160,
  }));
  entries.push(entry('POST', 'https://api.collab.example.com/api/v1/files/upload', {
    reqHeaders: [...authHeaders(), { name: 'Content-Type', value: 'multipart/form-data; boundary=----FormBoundary' }],
    postData: '------FormBoundary\r\nContent-Disposition: form-data; name="file"; filename="screenshot.png"\r\nContent-Type: image/png\r\n\r\n[binary data]\r\n------FormBoundary--',
    resText: '{"fileId":"file_001","url":"https://files.collab.example.com/file_001/screenshot.png","size":245000}',
    time: 500,
  }));
  entries.push(entry('GET', 'https://api.collab.example.com/api/v1/users/search?q=john&workspaceId=ws_001', {
    reqHeaders: authHeaders(),
    resText: '{"users":[{"id":"u_john","name":"John Smith","email":"john@example.com","avatar":"https://files.collab.example.com/avatars/u_john.jpg"},{"id":"u_johnny","name":"Johnny Doe","email":"johnny@example.com"}]}',
    time: 110,
  }));
  entries.push(entry('POST', 'https://api.collab.example.com/api/v1/documents/doc_8827/export', {
    reqHeaders: authHeaders(),
    postData: { format: 'pdf' },
    resText: '{"downloadUrl":"https://files.collab.example.com/exports/doc_8827.pdf","expiresAt":"2026-02-24T15:00:00Z","size":524288}',
    time: 300,
  }));

  // More static noise
  for (let i = 0; i < 4; i++) entries.push(staticAsset(`https://app.collab.example.com/static/js/vendor.${i}.js`));
  entries.push(entry('OPTIONS', 'https://api.collab.example.com/api/v1/documents', { status: 204, time: 8 }));

  return har('Collaboration App', entries);
}

// ---------------------------------------------------------------------------
// Write all fixtures
// ---------------------------------------------------------------------------
const fixtures = {
  'spa-dashboard.har': genSpaDashboard,
  'streaming-platform.har': genStreamingPlatform,
  'fintech-banking.har': genFintechBanking,
  'travel-booking.har': genTravelBooking,
  'realtime-collab.har': genRealtimeCollab,
};

for (const [name, gen] of Object.entries(fixtures)) {
  const filePath = path.join(FIXTURES_DIR, name);
  const data = gen();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Generated ${name}: ${data.log.entries.length} entries`);
}

console.log('\nAll fixtures generated successfully!');
