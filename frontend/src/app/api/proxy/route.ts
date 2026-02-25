import { NextRequest, NextResponse } from 'next/server';
import { parseCurl, ParsedRequest } from '@/lib/code-generators';

interface ProxyRequest {
  curl: string;
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
