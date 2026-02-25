/**
 * Headers to exclude when generating curl commands.
 * These are browser-internal, auto-managed, or noise headers.
 */
export const SKIP_HEADERS: Set<string> = new Set([
  // HTTP/2 pseudo-headers
  ':authority',
  ':method',
  ':path',
  ':scheme',

  // Auto-managed by curl
  'host',
  'connection',
  'content-length',

  // Browser-only
  'accept-encoding',
  'accept-language',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'sec-fetch-user',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-ch-ua-full-version-list',
  'sec-ch-ua-arch',
  'sec-ch-ua-bitness',
  'sec-ch-ua-model',
  'sec-ch-ua-wow64',
  'upgrade-insecure-requests',
  'cache-control',
  'pragma',
  'dnt',
  'priority',
]);
