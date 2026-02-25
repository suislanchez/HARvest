import { Injectable } from '@nestjs/common';
import type { Entry } from 'har-format';
import { SKIP_HEADERS } from '../../common/constants/skip-headers';

export interface ParsedCurlRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

@Injectable()
export class HarToCurlService {
  /**
   * Convert a HAR entry to a curl command string.
   * Uses --data-raw (not -d) to avoid @ interpretation.
   * Skips browser-only headers for clean output.
   */
  generateCurl(entry: Entry): string {
    const req = entry.request;
    const parts: string[] = ['curl'];

    // URL (single-quoted to prevent shell expansion of & and other chars)
    parts.push(this.shellQuote(req.url));

    // Method: skip -X for GET (default) and POST when body is present (curl infers)
    const hasBody = !!req.postData?.text;
    if (req.method !== 'GET' && !(req.method === 'POST' && hasBody)) {
      parts.push(`-X ${req.method}`);
    }

    // Headers: skip noise headers, keep functional ones
    for (const header of req.headers) {
      const name = header.name.toLowerCase();
      if (SKIP_HEADERS.has(name)) continue;
      // Skip cookie header if we'll use -b instead
      if (name === 'cookie') continue;
      parts.push(`-H ${this.shellQuote(`${header.name}: ${header.value}`)}`);
    }

    // Cookies
    const cookieHeader = req.headers.find(
      (h) => h.name.toLowerCase() === 'cookie',
    );
    if (cookieHeader && cookieHeader.value) {
      parts.push(`-b ${this.shellQuote(cookieHeader.value)}`);
    }

    // Request body
    if (hasBody) {
      parts.push(`--data-raw ${this.shellQuote(req.postData!.text!)}`);
    }

    // Add --compressed for cleaner output
    parts.push('--compressed');

    // Format multi-line with backslash continuation
    return parts.join(' \\\n  ');
  }

  /**
   * Parse a curl command string back into request components.
   * Used by the frontend "Execute" feature.
   */
  parseCurlToRequest(curl: string): ParsedCurlRequest {
    // Remove line continuations and normalize whitespace
    const normalized = curl.replace(/\\\n\s*/g, ' ').trim();

    const result: ParsedCurlRequest = {
      url: '',
      method: 'GET',
      headers: {},
    };

    // Simple token-based parser
    const tokens = this.tokenize(normalized);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (token === 'curl') continue;

      if (token === '-X' && i + 1 < tokens.length) {
        result.method = tokens[++i];
      } else if (token === '-H' && i + 1 < tokens.length) {
        const headerStr = tokens[++i];
        const colonIdx = headerStr.indexOf(':');
        if (colonIdx !== -1) {
          const name = headerStr.substring(0, colonIdx).trim();
          const value = headerStr.substring(colonIdx + 1).trim();
          result.headers[name] = value;
        }
      } else if (token === '-b' && i + 1 < tokens.length) {
        result.headers['Cookie'] = tokens[++i];
      } else if (
        (token === '--data-raw' || token === '-d' || token === '--data') &&
        i + 1 < tokens.length
      ) {
        result.body = tokens[++i];
        if (result.method === 'GET') result.method = 'POST';
      } else if (token === '--compressed') {
        // Skip, not needed for execution
      } else if (!token.startsWith('-') && !result.url) {
        result.url = token;
      }
    }

    return result;
  }

  /**
   * Shell-safe quoting with single quotes.
   * Handles the O'Brien problem by breaking out of single quotes.
   */
  private shellQuote(str: string): string {
    // If no single quotes, just wrap in single quotes
    if (!str.includes("'")) {
      return `'${str}'`;
    }
    // Replace ' with '\'' (end quote, escaped quote, start quote)
    return "'" + str.replace(/'/g, "'\\''") + "'";
  }

  /**
   * Tokenize a curl command, respecting quoted strings.
   */
  private tokenize(input: string): string[] {
    const tokens: string[] = [];
    let i = 0;

    while (i < input.length) {
      // Skip whitespace
      while (i < input.length && /\s/.test(input[i])) i++;
      if (i >= input.length) break;

      let token = '';

      if (input[i] === "'") {
        // Single-quoted string
        i++; // skip opening quote
        while (i < input.length && input[i] !== "'") {
          token += input[i++];
        }
        i++; // skip closing quote
      } else if (input[i] === '"') {
        // Double-quoted string
        i++; // skip opening quote
        while (i < input.length && input[i] !== '"') {
          if (input[i] === '\\' && i + 1 < input.length) {
            i++; // skip escape
          }
          token += input[i++];
        }
        i++; // skip closing quote
      } else {
        // Unquoted token
        while (i < input.length && !/\s/.test(input[i])) {
          token += input[i++];
        }
      }

      if (token) tokens.push(token);
    }

    return tokens;
  }
}
