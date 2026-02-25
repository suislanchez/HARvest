/**
 * Domains to auto-filter from HAR files.
 * These are analytics, tracking, ad networks, and CDN-only domains
 * that will never be the target API.
 */
export const SKIP_DOMAINS: string[] = [
  // Google Analytics & Ads
  'google-analytics.com',
  'www.google-analytics.com',
  'ssl.google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'www.googletagmanager.com',
  'googlesyndication.com',
  'googleadservices.com',
  'doubleclick.net',
  'pagead2.googlesyndication.com',

  // Facebook / Meta
  'connect.facebook.net',
  'www.facebook.com',
  'pixel.facebook.com',

  // Microsoft
  'clarity.ms',
  'bat.bing.com',
  'c.bing.com',

  // Hotjar
  'hotjar.com',
  'static.hotjar.com',
  'script.hotjar.com',
  'vars.hotjar.com',

  // Other analytics
  'cdn.segment.com',
  'api.segment.io',
  'api.mixpanel.com',
  'cdn.mxpnl.com',
  'api.amplitude.com',
  'heapanalytics.com',
  'sentry.io',
  'browser.sentry-cdn.com',
  'browser-intake-datadoghq.com',
  'bam.nr-data.net',
  'js-agent.newrelic.com',
  'fullstory.com',
  'rs.fullstory.com',

  // Marketing/CRM
  'js.hs-analytics.net',
  'js.hsforms.net',
  'js.hs-scripts.com',
  'track.hubspot.com',
  'snap.licdn.com',
  'px.ads.linkedin.com',
  'analytics.tiktok.com',
  'stats.wp.com',
  'mc.yandex.ru',
  'cdn.cookielaw.org',

  // CDN-only (static assets)
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'use.fontawesome.com',
  'stackpath.bootstrapcdn.com',
  'maxcdn.bootstrapcdn.com',
];
