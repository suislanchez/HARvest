export interface DetectedSecret {
  type: 'bearer_token' | 'api_key' | 'cookie' | 'basic_auth' | 'custom';
  name: string;
  value: string;
  location: string;
}

export function detectSecrets(curl: string): DetectedSecret[] {
  const secrets: DetectedSecret[] = [];
  const seen = new Set<string>();

  const add = (s: DetectedSecret) => {
    const key = `${s.type}:${s.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      secrets.push(s);
    }
  };

  // Bearer token: -H 'Authorization: Bearer <token>'
  const bearerMatch = curl.match(/Authorization:\s*Bearer\s+([^\s'"\\]+)/i);
  if (bearerMatch) {
    add({
      type: 'bearer_token',
      name: 'BEARER_TOKEN',
      value: bearerMatch[1],
      location: 'header:Authorization',
    });
  }

  // Basic auth: -H 'Authorization: Basic <base64>'
  const basicMatch = curl.match(/Authorization:\s*Basic\s+([^\s'"\\]+)/i);
  if (basicMatch) {
    add({
      type: 'basic_auth',
      name: 'BASIC_AUTH',
      value: basicMatch[1],
      location: 'header:Authorization',
    });
  }

  // Cookie via -b flag
  const cookieFlag = curl.match(/-b\s+['"]([^'"]+)['"]/);
  if (cookieFlag) {
    add({
      type: 'cookie',
      name: 'COOKIE',
      value: cookieFlag[1],
      location: 'flag:-b',
    });
  }

  // Cookie header
  const cookieHeader = curl.match(/Cookie:\s*([^\s'"\\][^'"\\]*)/i);
  if (cookieHeader) {
    add({
      type: 'cookie',
      name: 'COOKIE',
      value: cookieHeader[1].trim(),
      location: 'header:Cookie',
    });
  }

  // Headers matching *-key, *-token, *-secret, x-api-key patterns
  const headerPattern = /(?:^|\s)-H\s+['"]([^'"]+)['"]/g;
  let headerMatch;
  while ((headerMatch = headerPattern.exec(curl)) !== null) {
    const header = headerMatch[1];
    const colonIdx = header.indexOf(':');
    if (colonIdx === -1) continue;
    const headerName = header.substring(0, colonIdx).trim().toLowerCase();
    const headerValue = header.substring(colonIdx + 1).trim();

    if (!headerValue || headerName === 'authorization' || headerName === 'cookie') continue;

    if (
      headerName.includes('key') ||
      headerName.includes('token') ||
      headerName.includes('secret') ||
      headerName.includes('auth')
    ) {
      const varName = headerName
        .replace(/[^a-z0-9]+/gi, '_')
        .toUpperCase();
      add({
        type: 'api_key',
        name: varName,
        value: headerValue,
        location: `header:${header.substring(0, colonIdx).trim()}`,
      });
    }
  }

  // Query params: api_key=, token=, key=, secret=, access_token=
  const urlMatch = curl.match(/['"]?(https?:\/\/[^\s'"]+)['"]?/);
  if (urlMatch) {
    try {
      const url = new URL(urlMatch[1]);
      for (const [param, value] of url.searchParams) {
        const p = param.toLowerCase();
        if (
          p.includes('key') ||
          p.includes('token') ||
          p.includes('secret') ||
          p === 'api_key' ||
          p === 'apikey'
        ) {
          const varName = param.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
          add({
            type: 'api_key',
            name: varName,
            value,
            location: `query:${param}`,
          });
        }
      }
    } catch { /* invalid URL */ }
  }

  return secrets;
}

export function parameterize(
  curl: string,
  replacements: Map<string, string>,
): string {
  let result = curl;
  for (const [value, varName] of replacements) {
    // Escape regex special chars in the value
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), `{{${varName}}}`);
  }
  return result;
}
