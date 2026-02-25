# SSRF Deep Dive & Security Hardening

Research into SSRF bypass techniques and comprehensive mitigation strategies for the curl execution proxy.

## Current State

Our proxy (`frontend/src/app/api/proxy/route.ts`) blocks:
- Private IPs: `10.x`, `172.16-31.x`, `192.168.x`, `169.254.x`, `0.x`
- Localhost: `127.0.0.1`, `::1`, `localhost`, `0.0.0.0`
- Cloud metadata: `169.254.169.254`, `metadata.google.internal`
- Non-HTTP protocols

**What it doesn't handle**: DNS rebinding, IPv6 private ranges, IP encoding tricks, and several other bypass techniques documented below.

---

## 1. DNS Rebinding Attacks

### The Attack

DNS rebinding exploits the time gap between URL validation and the actual HTTP request (TOCTOU — time-of-check, time-of-use):

```
1. Attacker submits URL: http://evil.attacker.com/secret
2. Proxy resolves evil.attacker.com → 203.0.113.1 (public IP, passes validation)
3. DNS TTL expires (attacker set TTL=0)
4. Proxy makes the HTTP request, DNS re-resolves → 127.0.0.1
5. Request hits localhost — SSRF achieved
```

Tools like `1u.ms` allow creating domains that flip between IPs automatically (e.g., `make-1.2.3.4-rebind-127.0.0.1-rr.1u.ms`).

**Real CVEs**:
- **CVE-2024-24759** (MindsDB, CVSS 9.3): `is_private_url()` checked DNS at validation time, but the HTTP client re-resolved at request time
- **GHSA-wvjg-9879-3m7w** (AutoGPT): Same pattern in the requests wrapper

### Mitigation: Resolve-Then-Connect

The correct approach eliminates the TOCTOU gap by resolving DNS once, validating the IP, and connecting directly to that IP:

```
1. Resolve hostname → IP address(es)
2. Validate every resolved IP against blocklist
3. Connect to the validated IP directly (bypass DNS for the connection)
4. Set Host header to original hostname (for virtual hosting)
```

**Node.js implementation options**:

| Library | Approach | Notes |
|---------|----------|-------|
| `request-filtering-agent` | Hooks `http.Agent.createConnection` — validates at socket creation | Works with node-fetch, axios, got |
| `ssrf-req-filter` | Middleware approach, blocks private/reserved IPs | 60K weekly downloads |
| Custom `Agent` subclass | Override `createConnection`, resolve with `dns.resolve4`/`resolve6`, validate, connect to IP | Full control |

**Critical**: Node.js native `fetch` (undici) does not currently support custom Agents for SSRF filtering. If using native fetch, you must pre-validate DNS separately or switch to `node-fetch`/`axios`.

---

## 2. IPv6 SSRF Bypasses

### Private IPv6 Ranges to Block

| Range | CIDR | Description |
|-------|------|-------------|
| Loopback | `::1/128` | IPv6 equivalent of `127.0.0.1` |
| Unique Local (ULA) | `fc00::/7` | Private address space (covers `fc00::/8` and `fd00::/8`) |
| Link-Local | `fe80::/10` | Non-routable, like `169.254.0.0/16` |
| IPv4-mapped | `::ffff:0:0/96` | Embeds IPv4 addresses in IPv6 |
| Documentation | `2001:db8::/32` | Reserved for docs |
| Discard | `100::/64` | Discard prefix |

### IPv4-Mapped IPv6 — The Most Common Bypass

IPv4-mapped addresses embed a standard IPv4 address inside an IPv6 literal:

```
::ffff:127.0.0.1          → loopback
::ffff:7f00:1              → same, hex notation
0:0:0:0:0:ffff:7f00:1     → same, full form (most dangerous — many guards miss this)
0:0:0:0:0:ffff:a9fe:a9fe  → maps to 169.254.169.254 (AWS metadata)
```

**Real vulnerabilities**:
- **GHSA-jrvc-8ff5-2f9f** (OpenClaw): SSRF guard failed on `0:0:0:0:0:ffff:xxxx:xxxx` format
- **GHSA-26h3-8ww8-v5fc** (Discourse): Bypass via IPv4-mapped IPv6 addresses
- **is-localhost-ip 2.0.0**: `::ffff:7f00:1` not recognized as loopback

### Other IPv6 Bypass Techniques

- **Bracket notation**: `http://[::1]/`, `http://[fe80::1]/`, `http://[fc00::1]/` — URL requires brackets for IPv6
- **Expanded vs compressed**: `::1` and `0000:0000:0000:0000:0000:0000:0000:0001` are identical; naive regex may only match one form
- **AAAA-only records**: If SSRF validator only resolves `A` records (IPv4), a hostname with only `AAAA` records bypasses validation entirely (CVE-2026-27127 in Craft CMS)

### Mitigation

1. Parse IPv6 using `ipaddr.js` (normalizes all forms)
2. Convert IPv4-mapped IPv6 to canonical IPv4 before blocklist comparison
3. Block full ULA range (`fc00::/7`), link-local (`fe80::/10`), loopback (`::1/128`)
4. Resolve both `A` and `AAAA` records and validate all returned IPs

---

## 3. IP Encoding Tricks

Operating systems accept many representations of the same IP address. String-based blocklists (`url.includes('127.0.0.1')`) miss all of these:

### Numeric Encodings of 127.0.0.1

| Encoding | Value | How it works |
|----------|-------|-------------|
| Decimal/dword | `2130706433` | 32-bit integer: `http://2130706433/` |
| Hexadecimal | `0x7f000001` | Full hex: `http://0x7f000001/` |
| Hex per-octet | `0x7f.0x00.0x00.0x01` | Each octet in hex |
| Octal | `0177.0.0.1` | Leading zero = octal |
| Full octal | `017700000001` | 32-bit octal |
| Mixed notation | `0177.0.0x00.1` | Combine bases per-octet |
| Short form | `127.1` | Omit zero octets (some parsers) |

### AWS Metadata (169.254.169.254) Bypasses

```
http://2852039166/              (decimal)
http://0xa9fea9fe/              (hex)
http://0xa9.0xfe.0xa9.0xfe/    (hex per-octet)
http://0251.0376.0251.0376/    (octal — bypassed AWS WAF SSRF managed rules, Sept 2023)
```

### URL-Level Tricks

| Technique | Example | How it works |
|-----------|---------|-------------|
| URL encoding | `%31%32%37%2e%30%2e%30%2e%31` | Percent-encode hostname characters |
| Double encoding | `%2531%2532%2537...` | If server decodes twice |
| @ credentials | `http://trusted.com@127.0.0.1/` | Parser treats first part as credentials |
| Fragment confusion | `http://expected.host#@127.0.0.1/` | Parser confusion with `#` before `@` |
| Open redirect | `https://trusted.com/redirect?url=http://127.0.0.1/` | Passes hostname check, follows redirect to internal IP |

### Mitigation

**Never do string matching for IP validation.** Parse the address into its numeric (integer) representation and compare numerically.

Use `ipaddr.js`:
```typescript
import { parse, IPv4, IPv6 } from 'ipaddr.js';

function isPrivateIP(ipStr: string): boolean {
  const addr = parse(ipStr);
  // Handles IPv4, IPv6, IPv4-mapped IPv6, all numeric encodings
  const range = addr.range();
  const blocked = ['private', 'loopback', 'linkLocal', 'uniqueLocal', 'unspecified'];
  return blocked.includes(range);
}
```

---

## 4. Content Security Policy

### Recommended CSP for the Frontend

```
Content-Security-Policy:
  default-src 'none';
  script-src 'self' 'nonce-{RANDOM}' 'strict-dynamic';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https:;
  font-src 'self';
  connect-src 'self';
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests;
```

### Key Decisions

**`script-src`**: Nonce-based with `'strict-dynamic'`. Generate a fresh nonce per request in `middleware.ts`. `'strict-dynamic'` propagates trust to dynamically loaded scripts.

**`style-src 'unsafe-inline'`**: Tailwind CSS v4 generates external CSS files, but Next.js injects some inline `<style>` tags for critical CSS. `'unsafe-inline'` for styles only is a pragmatic, widely accepted compromise — inline style injection is a lower-risk XSS vector than inline script injection.

**`connect-src 'self'`**: All API calls are same-origin (frontend proxies to backend). If the frontend calls external APIs directly, add those domains explicitly.

**`frame-ancestors 'none'`**: Prevents clickjacking. Modern replacement for `X-Frame-Options: DENY`. Set both for IE compatibility.

### Implementation in Next.js Middleware

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = `default-src 'none'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; ...`;

  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('x-nonce', nonce);
  return response;
}
```

**Note**: Using nonces forces all pages to be dynamically rendered (no static generation) since nonces must be unique per HTTP request.

### Additional Security Headers

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

---

## 5. Comprehensive SSRF Blocklist

A production-grade SSRF validator should check ALL of the following:

### IPv4 Ranges
| Range | CIDR | Purpose |
|-------|------|---------|
| `0.0.0.0/8` | Current network | Reserved |
| `10.0.0.0/8` | Private (RFC 1918) | Class A private |
| `100.64.0.0/10` | Carrier-grade NAT | Shared address space |
| `127.0.0.0/8` | Loopback | Localhost |
| `169.254.0.0/16` | Link-local | APIPA + cloud metadata |
| `172.16.0.0/12` | Private (RFC 1918) | Class B private |
| `192.0.0.0/24` | IETF protocol | Reserved |
| `192.0.2.0/24` | Documentation | TEST-NET-1 |
| `192.168.0.0/16` | Private (RFC 1918) | Class C private |
| `198.18.0.0/15` | Benchmarking | Network testing |
| `198.51.100.0/24` | Documentation | TEST-NET-2 |
| `203.0.113.0/24` | Documentation | TEST-NET-3 |
| `224.0.0.0/4` | Multicast | Reserved |
| `240.0.0.0/4` | Reserved | Future use |
| `255.255.255.255/32` | Broadcast | Limited broadcast |

### IPv6 Ranges
| Range | Purpose |
|-------|---------|
| `::1/128` | Loopback |
| `fc00::/7` | Unique Local Address |
| `fe80::/10` | Link-Local |
| `::ffff:0:0/96` | IPv4-mapped (check embedded IPv4) |
| `2001:db8::/32` | Documentation |
| `ff00::/8` | Multicast |

### Hostnames
- `localhost`, `localhost.localdomain`
- `metadata.google.internal` (GCP)
- `metadata.internal` (DigitalOcean)

### Protocols
- Allow only: `http:`, `https:`
- Block: `file:`, `ftp:`, `gopher:`, `dict:`, `ldap:`, `tftp:`, `data:`

---

## Recommended Implementation Strategy

1. **Use `ipaddr.js`** for all IP parsing and range checking (handles all encoding tricks, IPv4-mapped IPv6, etc.)
2. **Resolve DNS before connecting** via a custom HTTP Agent (`request-filtering-agent` or custom `createConnection` override)
3. **Validate ALL resolved IPs** (both A and AAAA records)
4. **Follow redirects manually** and re-validate each hop's destination IP
5. **Set CSP headers** in Next.js middleware
6. **Add security headers** (X-Frame-Options, X-Content-Type-Options, etc.)

## References

- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [HackTricks URL Format Bypass](https://book.hacktricks.wiki/en/pentesting-web/ssrf-server-side-request-forgery/url-format-bypass.html)
- [PayloadsAllTheThings SSRF](https://github.com/swisskyrepo/PayloadsAllTheThings/blob/master/Server%20Side%20Request%20Forgery/README.md)
- [PortSwigger URL Validation Bypass Cheat Sheet](https://portswigger.net/web-security/ssrf/url-validation-bypass-cheat-sheet)
- [request-filtering-agent (npm)](https://www.npmjs.com/package/request-filtering-agent)
- [ipaddr.js (npm)](https://www.npmjs.com/package/ipaddr.js)
- [Next.js CSP Guide](https://nextjs.org/docs/app/guides/content-security-policy)
