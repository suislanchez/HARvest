import { Injectable } from '@nestjs/common';
import type { Entry } from 'har-format';

export interface WsCommand {
  wscat: string;
  websocat: string;
}

@Injectable()
export class WsCommandService {
  /**
   * Generate wscat and websocat commands from a WebSocket HAR entry.
   */
  generateWsCommands(entry: Entry): WsCommand {
    const url = entry.request.url;
    const headers = entry.request.headers || [];

    // Build wscat command
    const wscatParts: string[] = ['wscat'];
    wscatParts.push(`-c ${this.shellQuote(url)}`);

    // Add auth headers
    for (const header of headers) {
      const name = header.name.toLowerCase();
      if (name === 'authorization' || name === 'x-api-key' || name.includes('api-key')) {
        wscatParts.push(`-H ${this.shellQuote(`${header.name}: ${header.value}`)}`);
      }
    }

    // Add cookie header
    const cookieHeader = headers.find((h) => h.name.toLowerCase() === 'cookie');
    if (cookieHeader && cookieHeader.value) {
      wscatParts.push(`-H ${this.shellQuote(`Cookie: ${cookieHeader.value}`)}`);
    }

    // Build websocat command
    const websocatParts: string[] = ['websocat'];
    websocatParts.push(this.shellQuote(url));

    for (const header of headers) {
      const name = header.name.toLowerCase();
      if (name === 'authorization' || name === 'x-api-key' || name.includes('api-key')) {
        websocatParts.push(`-H ${this.shellQuote(`${header.name}: ${header.value}`)}`);
      }
    }

    if (cookieHeader && cookieHeader.value) {
      websocatParts.push(`-H ${this.shellQuote(`Cookie: ${cookieHeader.value}`)}`);
    }

    return {
      wscat: wscatParts.join(' \\\n  '),
      websocat: websocatParts.join(' \\\n  '),
    };
  }

  /**
   * Check if a HAR entry is a WebSocket connection.
   */
  isWebSocketEntry(entry: Entry): boolean {
    const url = entry.request.url;
    if (url.startsWith('wss://') || url.startsWith('ws://')) return true;
    if (entry.response.status === 101) return true;
    const upgradeHeader = entry.request.headers?.find(
      (h) => h.name.toLowerCase() === 'upgrade' && h.value.toLowerCase() === 'websocket',
    );
    if (upgradeHeader) return true;
    // Check for _webSocketMessages (Chrome DevTools extension)
    if ((entry as any)._webSocketMessages) return true;
    return false;
  }

  /**
   * Check if a HAR entry is a Server-Sent Events stream.
   */
  isSSEEntry(entry: Entry): boolean {
    const acceptHeader = entry.request.headers?.find(
      (h) => h.name.toLowerCase() === 'accept',
    );
    if (acceptHeader?.value.includes('text/event-stream')) return true;
    const contentType = entry.response.content?.mimeType || '';
    if (contentType.includes('text/event-stream')) return true;
    return false;
  }

  /**
   * Generate a curl command for SSE (with --no-buffer for streaming).
   */
  generateSseCurl(entry: Entry): string {
    const req = entry.request;
    const parts: string[] = ['curl'];
    parts.push(`-N`); // --no-buffer for streaming
    parts.push(this.shellQuote(req.url));

    parts.push(`-H ${this.shellQuote('Accept: text/event-stream')}`);

    for (const header of req.headers) {
      const name = header.name.toLowerCase();
      if (name === 'accept') continue; // already added
      if (name === 'authorization' || name === 'x-api-key' || name.includes('api-key')) {
        parts.push(`-H ${this.shellQuote(`${header.name}: ${header.value}`)}`);
      }
    }

    const cookieHeader = req.headers.find((h) => h.name.toLowerCase() === 'cookie');
    if (cookieHeader && cookieHeader.value) {
      parts.push(`-b ${this.shellQuote(cookieHeader.value)}`);
    }

    return parts.join(' \\\n  ');
  }

  private shellQuote(str: string): string {
    if (!str.includes("'")) {
      return `'${str}'`;
    }
    return "'" + str.replace(/'/g, "'\\''") + "'";
  }
}
