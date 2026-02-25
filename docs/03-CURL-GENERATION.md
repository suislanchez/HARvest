# 3. Curl Command Generation - Complete Reference

## HAR-to-Curl Field Mapping

| HAR Field | Curl Flag | Notes |
|-----------|-----------|-------|
| `request.url` | Bare URL (positional) | Single-quote the URL to prevent `&` shell expansion |
| `request.method` | `-X METHOD` | Omit for GET (default). Omit for POST when `-d`/`--data-raw` is present (curl infers POST) |
| `request.headers[]` | `-H 'Name: Value'` | One per header |
| `request.cookies[]` | `-b 'name=val; ...'` | Or use `-H 'Cookie: ...'` |
| `request.postData.text` | `--data-raw 'body'` | **Use `--data-raw` not `-d`** - `-d` interprets `@` as file reference |
| `request.postData.params[]` | `-F 'name=value'` (multipart) or `-d 'name=val&...'` (urlencoded) | Depends on mimeType |

### --data vs --data-raw vs --data-binary
- **`-d` / `--data`**: Treats `@filename` as "read from file". Strips newlines. AVOID.
- **`--data-raw`**: Sends data exactly as-is. No `@` interpretation. **USE THIS.**
- **`--data-binary`**: Preserves newlines and binary. Use for binary payloads.

## Header Classification

### ALWAYS SKIP (don't include in curl)
```
:authority, :method, :path, :scheme          ← HTTP/2 pseudo-headers
Host                                          ← curl derives from URL
Connection                                    ← curl manages
Content-Length                                 ← curl calculates from body
Accept-Encoding                               ← use --compressed instead
Accept-Language                                ← usually irrelevant
Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest, Sec-Fetch-User
Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform
Sec-CH-UA-Full-Version-List, Sec-CH-UA-Arch, Sec-CH-UA-Bitness
Upgrade-Insecure-Requests
Cache-Control, Pragma
DNT, Priority
```

### ALWAYS INCLUDE (functionally significant)
```
Authorization                   ← Bearer tokens, Basic auth, API keys
Content-Type                    ← Server needs this to parse body
Accept                          ← When specific (not */*)
Cookie                          ← When auth-related
User-Agent                      ← Many APIs check this
Referer                         ← Some APIs validate for CSRF
Origin                          ← Required for CORS endpoints
X-* (all custom headers)        ← X-API-Key, X-CSRF-Token, etc.
```

### CONSIDER REDACTING (for shareable output)
```
Authorization → Bearer <REDACTED> or Bearer $API_TOKEN
Cookie → session=<REDACTED>
X-API-Key → <REDACTED> or $API_KEY
```

Better: use environment variables → `"Authorization: Bearer $API_TOKEN"`

## Shell Escaping

### The safe pattern: single-quote everything
```bash
curl 'https://api.example.com/data?key=value&other=123' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer eyJhbG...' \
  --data-raw '{"name": "John", "query": "SELECT * FROM users"}'
```

### When JSON body contains single quotes (O'Brien problem)
```bash
# Option 1: concatenation trick
--data-raw '{"name": "O'"'"'Brien"}'
# Breaks down: '..O' + "'" + 'Brien...'

# Option 2: $'...' syntax
--data-raw $'{"name": "O\'Brien"}'
```

### Special characters
- `$` in double-quoted strings → gets interpreted as variable. Use single quotes.
- `!` in double-quoted strings → history expansion in bash. Use single quotes.
- `&` in URLs → backgrounds the command. Always quote URLs.
- Unicode → percent-encode non-ASCII in URLs

## Curl Formatting Best Practices

### Multi-line (readable)
```bash
curl 'https://api.example.com/v1/users' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer eyJhbG...' \
  -H 'Accept: application/json' \
  --compressed \
  --data-raw '{"name": "John Doe", "email": "john@example.com"}'
```

### Useful optional flags
| Flag | When to add |
|------|-------------|
| `--compressed` | When original request had `Accept-Encoding` (replaces that header) |
| `-s` / `--silent` | When piping to `jq` |
| `-v` | For debugging |
| `-k` / `--insecure` | Only for self-signed certs / local dev |

## Implementation: harEntryToCurl()

```typescript
const SKIP_HEADERS = new Set([
  ':authority', ':method', ':path', ':scheme',
  'host', 'connection', 'content-length',
  'accept-encoding', 'accept-language',
  'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'sec-ch-ua-full-version-list', 'sec-ch-ua-arch', 'sec-ch-ua-bitness',
  'sec-ch-ua-model', 'sec-ch-ua-wow64',
  'upgrade-insecure-requests', 'cache-control', 'pragma', 'dnt', 'priority',
]);

function harEntryToCurl(entry: Entry): string {
  const req = entry.request;
  const parts: string[] = ['curl'];

  // URL
  parts.push(`'${req.url}'`);

  // Method (only if not GET and not implied by --data-raw)
  const hasBody = req.postData?.text;
  if (req.method !== 'GET' && !(req.method === 'POST' && hasBody)) {
    parts.push(`-X ${req.method}`);
  }

  // Headers
  for (const header of req.headers) {
    if (SKIP_HEADERS.has(header.name.toLowerCase())) continue;
    if (header.name.toLowerCase() === 'cookie' && !req.cookies.length) continue;
    parts.push(`-H '${header.name}: ${escapeQuotes(header.value)}'`);
  }

  // Cookies (if present and not already in headers)
  if (req.cookies.length) {
    const cookieStr = req.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    parts.push(`-b '${cookieStr}'`);
  }

  // Body
  if (hasBody) {
    parts.push(`--data-raw '${escapeQuotes(req.postData!.text!)}'`);
  }

  // Compressed
  parts.push('--compressed');

  return parts.join(' \\\n  ');
}

function escapeQuotes(str: string): string {
  return str.replace(/'/g, "'\"'\"'");
}
```

## Security Checklist

- [ ] Never log generated curl commands server-side (contain auth tokens)
- [ ] Offer redacted version for sharing vs executable version
- [ ] Use `$ENV_VAR` placeholders for secrets when displaying
- [ ] Warn users that curl commands may contain session tokens
- [ ] HAR files themselves contain cookies/tokens - handle with care
