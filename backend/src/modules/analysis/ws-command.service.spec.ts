import { WsCommandService } from './ws-command.service';
import type { Entry } from 'har-format';

describe('WsCommandService', () => {
  let service: WsCommandService;

  beforeEach(() => {
    service = new WsCommandService();
  });

  const makeEntry = (overrides: Partial<Entry> & { request: Partial<Entry['request']>; response: Partial<Entry['response']> }): Entry => ({
    startedDateTime: '2026-01-01T00:00:00.000Z',
    time: 100,
    cache: {},
    timings: { send: 0, wait: 100, receive: 0 },
    ...overrides,
    request: {
      method: 'GET',
      url: 'wss://ws.example.com/realtime',
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [],
      queryString: [],
      headersSize: -1,
      bodySize: 0,
      ...overrides.request,
    },
    response: {
      status: 101,
      statusText: 'Switching Protocols',
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [],
      content: { size: 0, mimeType: '' },
      redirectURL: '',
      headersSize: -1,
      bodySize: 0,
      ...overrides.response,
    },
  }) as Entry;

  describe('isWebSocketEntry', () => {
    it('detects wss:// URL', () => {
      const entry = makeEntry({ request: { url: 'wss://ws.example.com/ws' }, response: { status: 101 } });
      expect(service.isWebSocketEntry(entry)).toBe(true);
    });

    it('detects ws:// URL', () => {
      const entry = makeEntry({ request: { url: 'ws://localhost:8080/ws' }, response: { status: 101 } });
      expect(service.isWebSocketEntry(entry)).toBe(true);
    });

    it('detects 101 status', () => {
      const entry = makeEntry({ request: { url: 'https://example.com/ws' }, response: { status: 101 } });
      expect(service.isWebSocketEntry(entry)).toBe(true);
    });

    it('detects Upgrade header', () => {
      const entry = makeEntry({
        request: {
          url: 'https://example.com/ws',
          headers: [{ name: 'Upgrade', value: 'websocket' }],
        },
        response: { status: 200 },
      });
      expect(service.isWebSocketEntry(entry)).toBe(true);
    });

    it('detects _webSocketMessages', () => {
      const entry = makeEntry({
        request: { url: 'https://example.com/ws' },
        response: { status: 200 },
      });
      (entry as any)._webSocketMessages = [{ type: 'send', data: 'test' }];
      expect(service.isWebSocketEntry(entry)).toBe(true);
    });

    it('rejects normal HTTP entry', () => {
      const entry = makeEntry({
        request: { url: 'https://api.example.com/data' },
        response: { status: 200 },
      });
      expect(service.isWebSocketEntry(entry)).toBe(false);
    });
  });

  describe('isSSEEntry', () => {
    it('detects text/event-stream accept header', () => {
      const entry = makeEntry({
        request: {
          url: 'https://api.example.com/events',
          headers: [{ name: 'Accept', value: 'text/event-stream' }],
        },
        response: { status: 200 },
      });
      expect(service.isSSEEntry(entry)).toBe(true);
    });

    it('detects text/event-stream content-type', () => {
      const entry = makeEntry({
        request: { url: 'https://api.example.com/events' },
        response: {
          status: 200,
          content: { size: 100, mimeType: 'text/event-stream' },
        },
      });
      expect(service.isSSEEntry(entry)).toBe(true);
    });

    it('rejects normal JSON response', () => {
      const entry = makeEntry({
        request: { url: 'https://api.example.com/data' },
        response: {
          status: 200,
          content: { size: 100, mimeType: 'application/json' },
        },
      });
      expect(service.isSSEEntry(entry)).toBe(false);
    });
  });

  describe('generateWsCommands', () => {
    it('generates basic wscat command', () => {
      const entry = makeEntry({
        request: { url: 'wss://ws.example.com/realtime' },
        response: { status: 101 },
      });
      const cmds = service.generateWsCommands(entry);
      expect(cmds.wscat).toContain('wscat');
      expect(cmds.wscat).toContain('wss://ws.example.com/realtime');
      expect(cmds.websocat).toContain('websocat');
      expect(cmds.websocat).toContain('wss://ws.example.com/realtime');
    });

    it('includes auth headers', () => {
      const entry = makeEntry({
        request: {
          url: 'wss://ws.example.com/realtime',
          headers: [
            { name: 'Authorization', value: 'Bearer token123' },
          ],
        },
        response: { status: 101 },
      });
      const cmds = service.generateWsCommands(entry);
      expect(cmds.wscat).toContain('Authorization: Bearer token123');
      expect(cmds.websocat).toContain('Authorization: Bearer token123');
    });

    it('includes cookie header', () => {
      const entry = makeEntry({
        request: {
          url: 'wss://ws.example.com/realtime',
          headers: [
            { name: 'Cookie', value: 'session=abc123' },
          ],
        },
        response: { status: 101 },
      });
      const cmds = service.generateWsCommands(entry);
      expect(cmds.wscat).toContain('Cookie: session=abc123');
    });
  });

  describe('generateSseCurl', () => {
    it('generates curl with -N flag', () => {
      const entry = makeEntry({
        request: {
          url: 'https://api.example.com/events',
          headers: [
            { name: 'Accept', value: 'text/event-stream' },
            { name: 'Authorization', value: 'Bearer token123' },
          ],
        },
        response: {
          status: 200,
          content: { size: 100, mimeType: 'text/event-stream' },
        },
      });
      const curl = service.generateSseCurl(entry);
      expect(curl).toContain('curl');
      expect(curl).toContain('-N');
      expect(curl).toContain('text/event-stream');
      expect(curl).toContain('Authorization: Bearer token123');
    });
  });
});
