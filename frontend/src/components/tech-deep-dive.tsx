'use client';

import { X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface TechDeepDiveProps {
  isOpen: boolean;
  onClose: () => void;
}

const filterLayers = [
  { num: 1, name: 'URL validity', catches: 'data: URIs, empty URLs' },
  { num: 2, name: 'HTTP status', catches: 'Aborted requests (status 0)' },
  { num: 3, name: 'Method', catches: 'OPTIONS preflight' },
  { num: 4, name: 'Redirects', catches: '301, 302, 303, 307, 308' },
  { num: 5, name: 'Extensions', catches: '27 patterns (js, css, png, woff2...)' },
  { num: 6, name: 'Domains', catches: '71 analytics/tracking/CDN domains' },
  { num: 7, name: 'MIME types', catches: 'html, css, javascript, wasm' },
  { num: 8, name: 'Media prefixes', catches: 'image/*, font/*, audio/*, video/*' },
];

export function TechDeepDive({ isOpen, onClose }: TechDeepDiveProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative z-10 w-full max-w-2xl max-h-[85vh] overflow-y-auto animate-scale-in">
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-card">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">How It Works — Under the Hood</h2>
          <Button variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <CardContent className="p-6 space-y-4">
          {/* Section 1: Filter Pipeline */}
          <details className="group animate-fade-in-up" style={{ animationDelay: '0ms' }} open>
            <summary className="cursor-pointer flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 py-2">
              <span className="text-xs text-zinc-400 group-open:rotate-90 transition-transform">&#9654;</span>
              8-Layer Filter Pipeline
            </summary>
            <div className="pl-5 space-y-2 pb-3">
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                Eliminates ~85% of noise before any AI processing, dramatically reducing cost and improving accuracy.
              </p>
              {filterLayers.map((layer) => (
                <div key={layer.num} className="flex items-center gap-3 text-xs">
                  <span className="h-5 w-5 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center font-mono text-zinc-600 dark:text-zinc-400 shrink-0">
                    {layer.num}
                  </span>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300 w-24 shrink-0">{layer.name}</span>
                  <Badge variant="outline" className="text-[10px] font-normal">{layer.catches}</Badge>
                </div>
              ))}
            </div>
          </details>

          {/* Section 2: Dedup Algorithm */}
          <details className="group animate-fade-in-up" style={{ animationDelay: '100ms' }}>
            <summary className="cursor-pointer flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 py-2 border-t border-zinc-200 dark:border-zinc-800 pt-4">
              <span className="text-xs text-zinc-400 group-open:rotate-90 transition-transform">&#9654;</span>
              Dedup Algorithm
            </summary>
            <div className="pl-5 space-y-2 pb-3 text-xs text-zinc-600 dark:text-zinc-400">
              <p className="mb-2">Groups duplicate requests by computed key:</p>
              <code className="block bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-2 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                {'{METHOD} {parameterizedPath}{:operationName}'}
              </code>
              <ul className="list-disc pl-4 space-y-1 mt-2">
                <li>UUID segments &rarr; <code className="font-mono text-[11px]">/{'{id}'}</code>, numeric segments &rarr; <code className="font-mono text-[11px]">/{'{id}'}</code></li>
                <li>GraphQL: appends <code className="font-mono text-[11px]">:operationName</code> from request body</li>
                <li>Per-hostname grouping, first occurrence is the representative</li>
              </ul>
            </div>
          </details>

          {/* Section 3: LLM Strategy */}
          <details className="group animate-fade-in-up" style={{ animationDelay: '200ms' }}>
            <summary className="cursor-pointer flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 py-2 border-t border-zinc-200 dark:border-zinc-800 pt-4">
              <span className="text-xs text-zinc-400 group-open:rotate-90 transition-transform">&#9654;</span>
              LLM Strategy
            </summary>
            <div className="pl-5 space-y-2 pb-3 text-xs text-zinc-600 dark:text-zinc-400">
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-2">
                  <span className="text-zinc-500">Model</span>
                  <p className="font-mono text-zinc-700 dark:text-zinc-300">gpt-4o-mini</p>
                </div>
                <div className="bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-2">
                  <span className="text-zinc-500">Temperature</span>
                  <p className="font-mono text-zinc-700 dark:text-zinc-300">0.1</p>
                </div>
                <div className="bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-2">
                  <span className="text-zinc-500">Max tokens</span>
                  <p className="font-mono text-zinc-700 dark:text-zinc-300">500</p>
                </div>
                <div className="bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-2">
                  <span className="text-zinc-500">Typical cost</span>
                  <p className="font-mono text-zinc-700 dark:text-zinc-300">~$0.0002/query</p>
                </div>
              </div>
              <ul className="list-disc pl-4 space-y-1 mt-2">
                <li>Structured JSON output (forced schema)</li>
                <li>Grouped summaries with auth redacted to <code className="font-mono">Bearer ***</code></li>
                <li>Typical: ~300-500 input tokens, ~50-100 output tokens</li>
              </ul>
            </div>
          </details>

          {/* Section 4: Curl Generation */}
          <details className="group animate-fade-in-up" style={{ animationDelay: '300ms' }}>
            <summary className="cursor-pointer flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 py-2 border-t border-zinc-200 dark:border-zinc-800 pt-4">
              <span className="text-xs text-zinc-400 group-open:rotate-90 transition-transform">&#9654;</span>
              Curl Generation
            </summary>
            <div className="pl-5 space-y-2 pb-3 text-xs text-zinc-600 dark:text-zinc-400">
              <ul className="list-disc pl-4 space-y-1">
                <li><span className="font-medium text-zinc-700 dark:text-zinc-300">37 auto-skipped headers</span> &mdash; sec-*, pseudo-headers, browser-only</li>
                <li><span className="font-medium text-zinc-700 dark:text-zinc-300">Shell-safe escaping</span> &mdash; single-quote with proper escaping</li>
                <li>Uses <code className="font-mono">--data-raw</code> (not <code className="font-mono">-d</code>) to prevent @file injection</li>
                <li>Auto-adds <code className="font-mono">--compressed</code> flag</li>
              </ul>
            </div>
          </details>

          {/* Section 5: Security */}
          <details className="group animate-fade-in-up" style={{ animationDelay: '400ms' }}>
            <summary className="cursor-pointer flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 py-2 border-t border-zinc-200 dark:border-zinc-800 pt-4">
              <span className="text-xs text-zinc-400 group-open:rotate-90 transition-transform">&#9654;</span>
              Security
            </summary>
            <div className="pl-5 space-y-2 pb-3 text-xs text-zinc-600 dark:text-zinc-400">
              <ul className="list-disc pl-4 space-y-1">
                <li><span className="font-medium text-zinc-700 dark:text-zinc-300">SSRF protection</span> &mdash; blocks private IPs, IPv6, localhost, link-local</li>
                <li><span className="font-medium text-zinc-700 dark:text-zinc-300">Security headers</span> &mdash; X-Frame-Options DENY, X-Content-Type-Options nosniff, CSP</li>
                <li><span className="font-medium text-zinc-700 dark:text-zinc-300">Auth redaction</span> &mdash; sensitive values redacted in LLM summaries</li>
              </ul>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
