import { Injectable, BadRequestException } from '@nestjs/common';
import type { Har, Entry } from 'har-format';
import { SKIP_DOMAINS } from '../../common/constants/skip-domains';
import { SKIP_EXTENSIONS } from '../../common/constants/skip-extensions';

export interface HarSummary {
  index: number;
  method: string;
  url: string;
  status: number;
  responseContentType: string;
  hasAuth: boolean;
  bodyPreview: string | null;
  summary: string;
}

@Injectable()
export class HarParserService {
  /**
   * Parse and validate a HAR file buffer.
   */
  parseHar(buffer: Buffer): Har {
    let parsed: unknown;
    try {
      parsed = JSON.parse(buffer.toString('utf-8'));
    } catch {
      throw new BadRequestException('Invalid JSON: could not parse HAR file');
    }

    const har = parsed as Har;
    if (!har?.log?.entries || !Array.isArray(har.log.entries)) {
      throw new BadRequestException('Invalid HAR file: missing log.entries');
    }

    return har;
  }

  /**
   * Pre-filter HAR entries to keep only likely API requests.
   * Conservative: only exclude what we're certain about.
   */
  filterApiRequests(entries: Entry[]): Entry[] {
    return entries.filter((entry) => {
      const url = entry.request.url;

      // Skip data URIs and empty URLs
      if (!url || url.startsWith('data:')) return false;

      // Skip failed/aborted requests
      if (entry.response.status === 0) return false;

      // Skip CORS preflight
      if (entry.request.method === 'OPTIONS') return false;

      // Skip redirects (the follow-up is a separate entry)
      const status = entry.response.status;
      if ([301, 302, 303, 307, 308].includes(status)) return false;

      // Skip static file extensions
      try {
        const pathname = new URL(url).pathname;
        if (SKIP_EXTENSIONS.test(pathname)) return false;
      } catch {
        // Invalid URL, skip
        return false;
      }

      // Skip known tracking/analytics domains
      try {
        const hostname = new URL(url).hostname;
        if (SKIP_DOMAINS.some((domain) => hostname === domain || hostname.endsWith('.' + domain))) {
          return false;
        }
      } catch {
        return false;
      }

      // Skip non-API MIME types in response
      const mimeType = this.getBaseMimeType(entry.response.content?.mimeType || '');
      const skipMimeTypes = [
        'text/html',
        'text/css',
        'application/javascript',
        'text/javascript',
        'application/x-javascript',
        'application/wasm',
      ];
      if (skipMimeTypes.includes(mimeType)) return false;

      // Skip image and font responses
      if (mimeType.startsWith('image/') || mimeType.startsWith('font/') || mimeType.startsWith('audio/') || mimeType.startsWith('video/')) {
        return false;
      }

      return true;
    });
  }

  /**
   * Generate compact summaries for LLM consumption.
   */
  summarizeEntries(entries: Entry[]): HarSummary[] {
    return entries.map((entry, index) => {
      const req = entry.request;
      const res = entry.response;
      const mimeType = this.getBaseMimeType(res.content?.mimeType || 'unknown');

      // Extract just the path + query for readability
      let urlPath: string;
      try {
        const parsed = new URL(req.url);
        urlPath = parsed.pathname + parsed.search;
        // Include hostname if it looks like an API subdomain
        if (parsed.hostname.startsWith('api.') || parsed.hostname !== new URL(entries[0]?.request.url || req.url).hostname) {
          urlPath = parsed.hostname + urlPath;
        }
      } catch {
        urlPath = req.url;
      }

      // Truncate for readability
      if (urlPath.length > 120) {
        urlPath = urlPath.substring(0, 117) + '...';
      }

      // Check for auth headers
      const hasAuth = req.headers.some(
        (h) =>
          h.name.toLowerCase() === 'authorization' ||
          h.name.toLowerCase() === 'x-api-key' ||
          h.name.toLowerCase().includes('api-key'),
      );

      // Request body preview (first 100 chars)
      const bodyPreview = req.postData?.text
        ? req.postData.text.substring(0, 100) + (req.postData.text.length > 100 ? '...' : '')
        : null;

      // One-liner summary for LLM
      let summary = `${index}. ${req.method} ${urlPath} → ${mimeType} ${res.status}`;
      if (hasAuth) summary += ' [AUTH]';
      if (bodyPreview) summary += ` body: ${bodyPreview}`;

      return {
        index,
        method: req.method,
        url: req.url,
        status: res.status,
        responseContentType: mimeType,
        hasAuth,
        bodyPreview,
        summary,
      };
    });
  }

  /**
   * Generate a grouped, token-efficient summary string for LLM consumption.
   * Entries are grouped by hostname with auth info and compact formatting.
   */
  generateLlmSummary(entries: Entry[], totalCount: number): string {
    // Group entries by hostname
    const groups = new Map<string, { entries: Entry[]; indices: number[]; authType: string | null }>();

    entries.forEach((entry, index) => {
      let hostname: string;
      try {
        hostname = new URL(entry.request.url).hostname;
      } catch {
        hostname = 'unknown';
      }

      if (!groups.has(hostname)) {
        groups.set(hostname, { entries: [], indices: [], authType: null });
      }
      const group = groups.get(hostname)!;
      group.entries.push(entry);
      group.indices.push(index);

      // Detect auth type (first one wins for the group)
      if (!group.authType) {
        const authHeader = entry.request.headers.find(
          (h) => h.name.toLowerCase() === 'authorization',
        );
        if (authHeader) {
          const type = authHeader.value.split(' ')[0]; // Bearer, Basic, etc.
          group.authType = `${type} ***`;
        } else {
          const apiKeyHeader = entry.request.headers.find(
            (h) =>
              h.name.toLowerCase() === 'x-api-key' ||
              h.name.toLowerCase().includes('api-key'),
          );
          if (apiKeyHeader) {
            group.authType = 'API-Key ***';
          }
        }
      }
    });

    const lines: string[] = [];
    lines.push(`=== HAR Analysis: ${entries.length} API requests from ${totalCount} total ===`);
    lines.push('');

    for (const [hostname, group] of groups) {
      // Group header
      const countLabel = group.entries.length === 1 ? '1 request' : `${group.entries.length} requests`;
      const authLabel = group.authType ? `, Auth: ${group.authType}` : '';
      lines.push(`[${hostname}] (${countLabel}${authLabel})`);

      // Each entry in the group
      group.entries.forEach((entry, groupIdx) => {
        const globalIndex = group.indices[groupIdx];
        const req = entry.request;
        const res = entry.response;

        // Path + query only
        let urlPath: string;
        try {
          const parsed = new URL(req.url);
          urlPath = parsed.pathname + parsed.search;
          // Parameterize numeric path segments: /users/123 → /users/{id}
          urlPath = urlPath.replace(/\/\d+(?=\/|$|\?)/g, '/{id}');
        } catch {
          urlPath = req.url;
        }

        // Truncate long URLs
        if (urlPath.length > 100) {
          urlPath = urlPath.substring(0, 97) + '...';
        }

        // Short mime type
        const mimeType = (res.content?.mimeType || '').split(';')[0].trim().toLowerCase();
        const shortMime =
          mimeType === 'application/json'
            ? 'json'
            : mimeType === 'text/plain'
              ? 'text'
              : mimeType === 'application/xml' || mimeType === 'text/xml'
                ? 'xml'
                : mimeType || '?';

        // Response size
        const size = res.content?.size || res.bodySize || 0;
        const sizeStr = size > 0 ? ` (${this.formatSize(size)})` : '';

        // Build the line
        let line = `  ${globalIndex}. ${req.method} ${urlPath} → ${res.status} ${shortMime}${sizeStr}`;

        // Request body preview (for POST/PUT/PATCH)
        if (req.postData?.text) {
          const bodyPreview = req.postData.text.substring(0, 120);
          const ellipsis = req.postData.text.length > 120 ? '...' : '';
          line += ` body: ${bodyPreview}${ellipsis}`;
        }
        // Response body preview (when no request body and response has text)
        else if (res.content?.text) {
          const preview = res.content.text.substring(0, 150);
          const ellipsis = res.content.text.length > 150 ? '...' : '';
          line += ` preview: ${preview}${ellipsis}`;
        }

        lines.push(line);
      });

      lines.push('');
    }

    return lines.join('\n').trim();
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  /**
   * Strip charset and whitespace from MIME type.
   */
  private getBaseMimeType(mimeType: string): string {
    return mimeType.split(';')[0].trim().toLowerCase();
  }
}
