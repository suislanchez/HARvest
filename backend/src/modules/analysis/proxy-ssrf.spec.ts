/**
 * Tests for the SSRF protection and curl parsing logic used in the proxy route.
 *
 * These functions are duplicated from frontend/src/app/api/proxy/route.ts
 * since they're not exported. This ensures the security logic is verified.
 */

// Re-implement the pure functions from route.ts for testing
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

function parseCurl(curl: string) {
  const normalized = curl.replace(/\\\n\s*/g, ' ').trim();
  const tokens = tokenize(normalized);
  const result: { url: string; method: string; headers: Record<string, string>; body?: string } = {
    url: '',
    method: 'GET',
    headers: {},
  };

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

// ---------------------------------------------------------------------------
// SSRF Protection Tests
// ---------------------------------------------------------------------------
describe('SSRF Protection (isBlockedUrl)', () => {
  describe('should allow legitimate external URLs', () => {
    it.each([
      'https://api.example.com/data',
      'https://jsonplaceholder.typicode.com/posts',
      'http://httpbin.org/get',
      'https://8.8.8.8/dns-query',
      'https://api.stripe.com/v1/charges',
    ])('allows %s', (url) => {
      expect(isBlockedUrl(url)).toBeNull();
    });
  });

  describe('should block localhost variants', () => {
    it.each([
      'http://localhost/admin',
      'http://localhost:3000/api',
      'http://127.0.0.1/secret',
      'http://127.0.0.1:8080/admin',
      'http://[::1]/admin',
      'http://0.0.0.0/admin',
    ])('blocks %s', (url) => {
      const result = isBlockedUrl(url);
      expect(result).not.toBeNull();
      expect(result).toContain('localhost');
    });
  });

  describe('should block private IP ranges', () => {
    it.each([
      ['http://10.0.0.1/internal', '10.x'],
      ['http://10.255.255.255/data', '10.x'],
      ['http://172.16.0.1/admin', '172.16'],
      ['http://172.31.255.255/data', '172.16-31'],
      ['http://192.168.0.1/router', '192.168'],
      ['http://192.168.1.100/api', '192.168'],
    ])('blocks %s', (url) => {
      const result = isBlockedUrl(url);
      expect(result).not.toBeNull();
      expect(result).toContain('private IP');
    });
  });

  describe('should NOT block public IPs in 172.x outside 16-31 range', () => {
    it.each([
      'http://172.15.0.1/data',
      'http://172.32.0.1/data',
    ])('allows %s', (url) => {
      expect(isBlockedUrl(url)).toBeNull();
    });
  });

  describe('should block cloud metadata endpoints', () => {
    it.each([
      'http://169.254.169.254/latest/meta-data',
      'http://metadata.google.internal/computeMetadata/v1',
    ])('blocks %s', (url) => {
      const result = isBlockedUrl(url);
      expect(result).not.toBeNull();
    });
  });

  describe('should block link-local IPs', () => {
    it('blocks 169.254.x.x', () => {
      const result = isBlockedUrl('http://169.254.1.1/data');
      expect(result).not.toBeNull();
      expect(result).toContain('link-local');
    });
  });

  describe('should block non-HTTP protocols', () => {
    it.each([
      'ftp://files.example.com/data',
      'file:///etc/passwd',
      'gopher://evil.com/exploit',
    ])('blocks %s', (url) => {
      const result = isBlockedUrl(url);
      expect(result).not.toBeNull();
      expect(result).toContain('protocol');
    });
  });

  describe('should block invalid URLs', () => {
    it('blocks non-URL strings', () => {
      expect(isBlockedUrl('not-a-url')).toBe('Invalid URL');
    });

    it('blocks empty string', () => {
      expect(isBlockedUrl('')).toBe('Invalid URL');
    });
  });

  describe('should block 0.x.x.x IPs', () => {
    it('blocks 0.0.0.0 as localhost', () => {
      expect(isBlockedUrl('http://0.0.0.0/data')).not.toBeNull();
    });

    it('blocks 0.1.2.3 as invalid IP', () => {
      const result = isBlockedUrl('http://0.1.2.3/data');
      expect(result).not.toBeNull();
      expect(result).toContain('invalid IP');
    });
  });

  describe('should verify Node.js URL normalization blocks octal/hex/decimal tricks', () => {
    it('blocks octal 0177.0.0.1 (Node normalizes to 127.0.0.1)', () => {
      const result = isBlockedUrl('http://0177.0.0.1/admin');
      expect(result).not.toBeNull();
    });

    it('blocks hex 0x7f000001 (Node normalizes to 127.0.0.1)', () => {
      const result = isBlockedUrl('http://0x7f000001/admin');
      expect(result).not.toBeNull();
    });

    it('blocks decimal 2130706433 (Node normalizes to 127.0.0.1)', () => {
      const result = isBlockedUrl('http://2130706433/admin');
      expect(result).not.toBeNull();
    });

    it('blocks hex 0xA9FEA9FE (169.254.169.254 metadata)', () => {
      const result = isBlockedUrl('http://0xA9FEA9FE/latest/meta-data');
      expect(result).not.toBeNull();
    });

    it('blocks credential-notation http://user@localhost/admin', () => {
      const result = isBlockedUrl('http://user@localhost/admin');
      expect(result).not.toBeNull();
      expect(result).toContain('localhost');
    });
  });

  describe('should block IPv6-mapped private IPs', () => {
    it('blocks IPv6-mapped loopback [::ffff:127.0.0.1]', () => {
      const result = isBlockedUrl('http://[::ffff:127.0.0.1]/admin');
      expect(result).not.toBeNull();
      expect(result).toContain('localhost');
    });

    it('blocks IPv6-mapped 10.x [::ffff:10.0.0.1]', () => {
      const result = isBlockedUrl('http://[::ffff:10.0.0.1]/internal');
      expect(result).not.toBeNull();
      expect(result).toContain('private IP');
    });

    it('blocks IPv6-mapped 192.168.x [::ffff:192.168.1.1]', () => {
      const result = isBlockedUrl('http://[::ffff:192.168.1.1]/router');
      expect(result).not.toBeNull();
      expect(result).toContain('private IP');
    });

    it('blocks IPv6-mapped metadata [::ffff:169.254.169.254]', () => {
      const result = isBlockedUrl('http://[::ffff:169.254.169.254]/latest/meta-data');
      expect(result).not.toBeNull();
    });

    it('blocks IPv6 all-zeros [::]', () => {
      const result = isBlockedUrl('http://[::]/admin');
      expect(result).not.toBeNull();
      expect(result).toContain('localhost');
    });

    it('blocks expanded IPv6 loopback [0:0:0:0:0:0:0:1]', () => {
      const result = isBlockedUrl('http://[0:0:0:0:0:0:0:1]/admin');
      expect(result).not.toBeNull();
      expect(result).toContain('localhost');
    });

    it('blocks IPv6-mapped loopback with port [::ffff:127.0.0.1]:8080', () => {
      const result = isBlockedUrl('http://[::ffff:127.0.0.1]:8080/admin');
      expect(result).not.toBeNull();
      expect(result).toContain('localhost');
    });
  });

  describe('should allow legitimate IPv6 addresses', () => {
    it('allows public IPv6 like Google DNS [2607:f8b0:4004:800::200e]', () => {
      // This may parse or may not depending on Node URL handling, but should NOT be blocked
      const result = isBlockedUrl('http://[2607:f8b0:4004:800::200e]/data');
      expect(result).toBeNull();
    });
  });

  describe('DNS rebinding limitation (documentation)', () => {
    it('cannot block DNS rebinding attacks (hostname resolves externally then changes)', () => {
      // A hostname like "evil.com" could resolve to 127.0.0.1 via DNS rebinding.
      // Our check only validates the hostname string, not the resolved IP.
      // This test documents the known limitation.
      const result = isBlockedUrl('http://evil.com/admin');
      expect(result).toBeNull(); // We can't block this — it looks like a valid external URL
    });
  });
});

// ---------------------------------------------------------------------------
// Proxy curl parsing tests
// ---------------------------------------------------------------------------
describe('Proxy parseCurl', () => {
  it('should parse a basic GET', () => {
    const result = parseCurl("curl 'https://api.example.com/data'");
    expect(result.url).toBe('https://api.example.com/data');
    expect(result.method).toBe('GET');
  });

  it('should parse POST with body', () => {
    const result = parseCurl(
      "curl 'https://api.example.com/search' --data-raw '{\"q\":\"test\"}'",
    );
    expect(result.method).toBe('POST');
    expect(result.body).toBe('{"q":"test"}');
  });

  it('should parse explicit method', () => {
    const result = parseCurl("curl 'https://api.example.com/item/1' -X PUT --data-raw '{}'");
    expect(result.method).toBe('PUT');
  });

  it('should parse multiple headers', () => {
    const result = parseCurl(
      "curl 'https://api.example.com/data' -H 'Authorization: Bearer tok' -H 'Accept: application/json'",
    );
    expect(result.headers['Authorization']).toBe('Bearer tok');
    expect(result.headers['Accept']).toBe('application/json');
  });

  it('should parse cookies via -b', () => {
    const result = parseCurl("curl 'https://api.example.com/me' -b 'session=abc'");
    expect(result.headers['Cookie']).toBe('session=abc');
  });

  it('should handle line continuations', () => {
    const result = parseCurl(
      "curl 'https://api.example.com/data' \\\n  -H 'Accept: application/json' \\\n  --compressed",
    );
    expect(result.url).toBe('https://api.example.com/data');
    expect(result.headers['Accept']).toBe('application/json');
  });

  it('should handle double-quoted values', () => {
    const result = parseCurl(
      'curl "https://api.example.com/data" -H "Content-Type: application/json"',
    );
    expect(result.url).toBe('https://api.example.com/data');
    expect(result.headers['Content-Type']).toBe('application/json');
  });
});
