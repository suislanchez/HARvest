export interface ParsedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export function tokenize(input: string): string[] {
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

export function parseCurl(curl: string): ParsedRequest {
  const normalized = curl.replace(/\\\n\s*/g, ' ').trim();
  const tokens = tokenize(normalized);

  const result: ParsedRequest = { url: '', method: 'GET', headers: {} };

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

export function toPython(req: ParsedRequest): string {
  const lines: string[] = ['import requests', ''];

  const headerEntries = Object.entries(req.headers);
  if (headerEntries.length > 0) {
    lines.push('headers = {');
    for (const [k, v] of headerEntries) {
      lines.push(`    "${k}": "${escStr(v)}",`);
    }
    lines.push('}');
    lines.push('');
  }

  const method = req.method.toLowerCase();
  const args: string[] = [`"${escStr(req.url)}"`];
  if (headerEntries.length > 0) args.push('headers=headers');

  if (req.body) {
    let isJson = false;
    try {
      JSON.parse(req.body);
      isJson = true;
    } catch { /* not json */ }

    if (isJson) {
      lines.push(`data = ${formatPythonDict(req.body)}`);
      lines.push('');
      args.push('json=data');
    } else {
      lines.push(`data = "${escStr(req.body)}"`);
      lines.push('');
      args.push('data=data');
    }
  }

  lines.push(`response = requests.${method}(`);
  for (let i = 0; i < args.length; i++) {
    lines.push(`    ${args[i]}${i < args.length - 1 ? ',' : ''}`);
  }
  lines.push(')');
  lines.push('');
  lines.push('print(response.status_code)');
  lines.push('print(response.text)');

  return lines.join('\n');
}

function formatPythonDict(jsonStr: string): string {
  try {
    const obj = JSON.parse(jsonStr);
    return JSON.stringify(obj, null, 4)
      .replace(/true/g, 'True')
      .replace(/false/g, 'False')
      .replace(/null/g, 'None');
  } catch {
    return `"${escStr(jsonStr)}"`;
  }
}

export function toJavaScript(req: ParsedRequest): string {
  const lines: string[] = [];

  const opts: string[] = [];
  opts.push(`  method: "${req.method}",`);

  const headerEntries = Object.entries(req.headers);
  if (headerEntries.length > 0) {
    opts.push('  headers: {');
    for (const [k, v] of headerEntries) {
      opts.push(`    "${k}": "${escStr(v)}",`);
    }
    opts.push('  },');
  }

  if (req.body) {
    opts.push(`  body: ${formatJsBody(req.body)},`);
  }

  lines.push(`const response = await fetch("${escStr(req.url)}", {`);
  lines.push(...opts);
  lines.push('});');
  lines.push('');
  lines.push('const data = await response.text();');
  lines.push('console.log(response.status, data);');

  return lines.join('\n');
}

function formatJsBody(body: string): string {
  try {
    JSON.parse(body);
    return `JSON.stringify(${body})`;
  } catch {
    return `"${escStr(body)}"`;
  }
}

export function toGo(req: ParsedRequest): string {
  const lines: string[] = [];
  lines.push('package main');
  lines.push('');
  lines.push('import (');
  lines.push('\t"fmt"');
  lines.push('\t"io"');
  lines.push('\t"net/http"');
  if (req.body) lines.push('\t"strings"');
  lines.push(')');
  lines.push('');
  lines.push('func main() {');

  if (req.body) {
    lines.push(`\tbody := strings.NewReader("${escStr(req.body)}")`);
    lines.push(`\treq, err := http.NewRequest("${req.method}", "${escStr(req.url)}", body)`);
  } else {
    lines.push(`\treq, err := http.NewRequest("${req.method}", "${escStr(req.url)}", nil)`);
  }

  lines.push('\tif err != nil {');
  lines.push('\t\tpanic(err)');
  lines.push('\t}');

  for (const [k, v] of Object.entries(req.headers)) {
    lines.push(`\treq.Header.Set("${escStr(k)}", "${escStr(v)}")`);
  }

  lines.push('');
  lines.push('\tclient := &http.Client{}');
  lines.push('\tresp, err := client.Do(req)');
  lines.push('\tif err != nil {');
  lines.push('\t\tpanic(err)');
  lines.push('\t}');
  lines.push('\tdefer resp.Body.Close()');
  lines.push('');
  lines.push('\tresBody, _ := io.ReadAll(resp.Body)');
  lines.push('\tfmt.Println(resp.StatusCode)');
  lines.push('\tfmt.Println(string(resBody))');
  lines.push('}');

  return lines.join('\n');
}

export function toRuby(req: ParsedRequest): string {
  const lines: string[] = [];
  lines.push("require 'net/http'");
  lines.push("require 'uri'");
  if (req.body) lines.push("require 'json'");
  lines.push('');
  lines.push(`uri = URI.parse("${escStr(req.url)}")`);
  lines.push('http = Net::HTTP.new(uri.host, uri.port)');
  lines.push('http.use_ssl = uri.scheme == "https"');
  lines.push('');

  const rubyClass = rubyMethodClass(req.method);
  lines.push(`request = Net::HTTP::${rubyClass}.new(uri.request_uri)`);

  for (const [k, v] of Object.entries(req.headers)) {
    lines.push(`request["${escStr(k)}"] = "${escStr(v)}"`);
  }

  if (req.body) {
    lines.push(`request.body = '${req.body.replace(/'/g, "\\'")}'`);
  }

  lines.push('');
  lines.push('response = http.request(request)');
  lines.push('puts response.code');
  lines.push('puts response.body');

  return lines.join('\n');
}

function rubyMethodClass(method: string): string {
  const map: Record<string, string> = {
    GET: 'Get', POST: 'Post', PUT: 'Put', PATCH: 'Patch',
    DELETE: 'Delete', HEAD: 'Head', OPTIONS: 'Options',
  };
  return map[method.toUpperCase()] || 'Get';
}

function escStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
