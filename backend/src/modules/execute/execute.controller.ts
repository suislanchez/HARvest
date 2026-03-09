import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { HarToCurlService } from '../analysis/har-to-curl.service';

interface ExecuteRequest {
  curl: string;
}

function isBlockedUrl(urlStr: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return 'Invalid URL';
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return `Blocked protocol: ${parsed.protocol}`;
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]' || hostname === '0.0.0.0') {
    return 'Blocked: localhost';
  }

  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    return 'Blocked: cloud metadata endpoint';
  }

  const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipMatch) {
    const [, a, b] = ipMatch.map(Number);
    if (a === 10) return 'Blocked: private IP (10.x.x.x)';
    if (a === 172 && b >= 16 && b <= 31) return 'Blocked: private IP (172.16-31.x.x)';
    if (a === 192 && b === 168) return 'Blocked: private IP (192.168.x.x)';
    if (a === 169 && b === 254) return 'Blocked: link-local IP';
    if (a === 0) return 'Blocked: invalid IP';
  }

  if (hostname.startsWith('[')) {
    const inner = hostname.slice(1, -1);
    if (inner === '::' || inner === '::1' || inner === '0:0:0:0:0:0:0:1') {
      return 'Blocked: localhost (IPv6)';
    }
    const mapped = inner.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (mapped) {
      const hi = parseInt(mapped[1], 16);
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

@Controller('execute')
export class ExecuteController {
  private readonly curlService = new HarToCurlService();

  @Post()
  async execute(@Body() body: ExecuteRequest) {
    if (!body.curl || typeof body.curl !== 'string') {
      throw new HttpException('Missing curl command', HttpStatus.BAD_REQUEST);
    }

    const parsed = this.curlService.parseCurlToRequest(body.curl);

    if (!parsed.url) {
      throw new HttpException('Could not parse URL from curl command', HttpStatus.BAD_REQUEST);
    }

    const blocked = isBlockedUrl(parsed.url);
    if (blocked) {
      throw new HttpException(blocked, HttpStatus.FORBIDDEN);
    }

    const start = Date.now();

    try {
      const fetchOptions: RequestInit = {
        method: parsed.method,
        headers: parsed.headers,
        signal: AbortSignal.timeout(30000),
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

      return {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
        body: responseBody,
        duration,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      if (message.includes('timeout') || message.includes('abort')) {
        throw new HttpException('Request timed out (30s)', HttpStatus.GATEWAY_TIMEOUT);
      }
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
