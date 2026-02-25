import { NextRequest, NextResponse } from 'next/server';

interface ProxyRequest {
  curl: string;
}

interface ParsedCurl {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

// SSRF protection: block private/internal IPs and metadata endpoints
function isBlockedUrl(urlStr: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return 'Invalid URL';
  }

  // Only allow http(s)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return `Blocked protocol: ${parsed.protocol}`;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]' || hostname === '0.0.0.0') {
    return 'Blocked: localhost';
  }

  // Block cloud metadata endpoints
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    return 'Blocked: cloud metadata endpoint';
  }

  // Block private IP ranges
  const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipMatch) {
    const [, a, b] = ipMatch.map(Number);
    if (a === 10) return 'Blocked: private IP (10.x.x.x)';
    if (a === 172 && b >= 16 && b <= 31) return 'Blocked: private IP (172.16-31.x.x)';
    if (a === 192 && b === 168) return 'Blocked: private IP (192.168.x.x)';
    if (a === 169 && b === 254) return 'Blocked: link-local IP';
    if (a === 0) return 'Blocked: invalid IP';
  }

  // Block IPv6 loopback and IPv6-mapped private IPs
  if (hostname.startsWith('[')) {
    const inner = hostname.slice(1, -1);
    if (inner === '::' || inner === '::1' || inner === '0:0:0:0:0:0:0:1') {
      return 'Blocked: localhost (IPv6)';
    }
    const mapped = inner.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (mapped) {
      const hi = parseInt(mapped[1], 16);
      const lo = parseInt(mapped[2], 16);
      const a = (hi >> 8) & 0xff, b = hi & 0xff;
      if (a === 127) return 'Blocked: localhost (IPv6-mapped)';
      if (a === 10) return 'Blocked: private IP (IPv6-mapped)';
      if (a === 172 && b >= 16 && b <= 31) return 'Blocked: private IP (IPv6-mapped)';
      if (a === 192 && b === 168) return 'Blocked: private IP (IPv6-mapped)';
      if (a === 169 && b === 254) return 'Blocked: link-local (IPv6-mapped)';
      if (a === 0) return 'Blocked: invalid IP (IPv6-mapped)';
    }
  }

  return null;
}

// Parse a curl command string into components
function parseCurl(curl: string): ParsedCurl {
  // Remove line continuations
  const normalized = curl.replace(/\\\n\s*/g, ' ').trim();
  const tokens = tokenize(normalized);

  const result: ParsedCurl = { url: '', method: 'GET', headers: {} };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === 'curl') continue;
    if (token === '-X' && i + 1 < tokens.length) {
      result.method = tokens[++i];
    } else if (token === '-H' && i + 1 < tokens.length) {
      const h = tokens[++i];
      const colonIdx = h.indexOf(':');
      if (colonIdx !== -1) {
        result.headers[h.substring(0, colonIdx).trim()] = h.substring(colonIdx + 1).trim();
      }
    } else if (token === '-b' && i + 1 < tokens.length) {
      result.headers['Cookie'] = tokens[++i];
    } else if ((token === '--data-raw' || token === '-d' || token === '--data') && i + 1 < tokens.length) {
      result.body = tokens[++i];
      if (result.method === 'GET') result.method = 'POST';
    } else if (token === '--compressed') {
      // skip
    } else if (!token.startsWith('-') && !result.url) {
      result.url = token;
    }
  }

  return result;
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i])) i++;
    if (i >= input.length) break;
    let token = '';
    if (input[i] === "'") {
      i++;
      while (i < input.length && input[i] !== "'") token += input[i++];
      i++;
    } else if (input[i] === '"') {
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) i++;
        token += input[i++];
      }
      i++;
    } else {
      while (i < input.length && !/\s/.test(input[i])) token += input[i++];
    }
    if (token) tokens.push(token);
  }
  return tokens;
}

export async function POST(request: NextRequest) {
  try {
    const body: ProxyRequest = await request.json();

    if (!body.curl || typeof body.curl !== 'string') {
      return NextResponse.json({ error: 'Missing curl command' }, { status: 400 });
    }

    const parsed = parseCurl(body.curl);

    if (!parsed.url) {
      return NextResponse.json({ error: 'Could not parse URL from curl command' }, { status: 400 });
    }

    // SSRF check
    const blocked = isBlockedUrl(parsed.url);
    if (blocked) {
      return NextResponse.json({ error: blocked }, { status: 403 });
    }

    const start = Date.now();

    const fetchOptions: RequestInit = {
      method: parsed.method,
      headers: parsed.headers,
      signal: AbortSignal.timeout(30000), // 30s timeout
    };

    if (parsed.body && parsed.method !== 'GET' && parsed.method !== 'HEAD') {
      fetchOptions.body = parsed.body;
    }

    const res = await fetch(parsed.url, fetchOptions);
    const duration = Date.now() - start;

    const responseBody = await res.text();
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return NextResponse.json({
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      body: responseBody,
      duration,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    if (message.includes('timeout') || message.includes('abort')) {
      return NextResponse.json({ error: 'Request timed out (30s)' }, { status: 504 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
