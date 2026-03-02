'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Braces, Github, History, Info } from 'lucide-react';
import { FileUpload } from '@/components/file-upload';
import { AutoCapture } from '@/components/auto-capture';
import { HarInspector } from '@/components/har-inspector';
import { DescriptionInput } from '@/components/description-input';
import { CurlOutput } from '@/components/curl-output';
import { ResponseViewer } from '@/components/response-viewer';
import { ResponseDiff } from '@/components/response-diff';
import { HowItWorks } from '@/components/how-it-works';
import { PipelineStats } from '@/components/pipeline-stats';
import { ThemeToggle } from '@/components/theme-toggle';
import { CollectionSidebar } from '@/components/collection-sidebar';
import { TechDeepDive } from '@/components/tech-deep-dive';
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts';
import { useHarData } from '@/hooks/use-har-data';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { findOriginalResponse } from '@/lib/har-utils';
import { saveToCollection, CollectionItem } from '@/lib/collection';

interface AnalysisStats {
  totalRequests: number;
  filteredRequests: number;
  uniqueRequests: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  processingTime: { total: number; parsing: number; llm: number };
}

interface AnalysisResult {
  curl: string;
  type?: 'http' | 'websocket' | 'sse';
  provider?: string;
  model?: string;
  matchedRequest: { method: string; url: string; status: number; contentType: string };
  confidence: number;
  reason: string;
  topMatches: Array<{ index: number; confidence: number; reason: string; method: string; url: string; curl?: string }>;
  stats: AnalysisStats;
  allRequests: Array<{ method: string; url: string; status: number; contentType: string; time: number }>;
}

interface ProxyResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
}

const PIPELINE_STEPS = [
  'Parsing HAR file...',
  'Filtering requests...',
  'Matching with AI...',
  'Generating curl...',
];

function PipelineStepper({ currentStep }: { currentStep: number }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="space-y-3">
          {PIPELINE_STEPS.map((label, i) => {
            const isDone = i < currentStep;
            const isCurrent = i === currentStep;
            return (
              <div key={label} className="flex items-center gap-3">
                {isDone ? (
                  <div className="h-5 w-5 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs animate-checkmark">
                    &#10003;
                  </div>
                ) : isCurrent ? (
                  <div className="h-5 w-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                ) : (
                  <div className="h-5 w-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700" />
                )}
                <span className={`text-sm ${isCurrent ? 'text-zinc-900 dark:text-zinc-100 font-medium' : isDone ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-400 dark:text-zinc-600'}`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const harData = useHarData();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pipelineStep, setPipelineStep] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proxyResponse, setProxyResponse] = useState<ProxyResponse | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [editedCurl, setEditedCurl] = useState<string | null>(null);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [selectedMatchIndex, setSelectedMatchIndex] = useState(0);

  // Derive active match from selectedMatchIndex
  const activeMatch = result?.topMatches?.[selectedMatchIndex];
  // The curl to display/execute: edited version, selected match, or original from result
  const activeCurl = editedCurl ?? activeMatch?.curl ?? result?.curl ?? '';
  const activeConfidence = activeMatch?.confidence ?? result?.confidence ?? 0;
  const activeReason = activeMatch?.reason ?? result?.reason ?? '';

  // Original response from HAR for diff view
  const originalResponse = useMemo(() => {
    if (!harData.har || !result?.matchedRequest) return null;
    return findOriginalResponse(harData.har, result.matchedRequest);
  }, [harData.har, result?.matchedRequest]);

  // Reset editedCurl and selectedMatch when result changes
  useEffect(() => {
    setEditedCurl(null);
    setSelectedMatchIndex(0);
  }, [result]);

  // Simulated pipeline step progression
  useEffect(() => {
    if (!isAnalyzing) return;
    setPipelineStep(0);
    const t1 = setTimeout(() => setPipelineStep(1), 300);
    const t2 = setTimeout(() => setPipelineStep(2), 700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isAnalyzing]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '?') { e.preventDefault(); setShortcutsOpen(v => !v); }
      if (e.key === 'h' || e.key === 'H') { e.preventDefault(); setCollectionOpen(v => !v); }
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); setInfoOpen(v => !v); }
      if (e.key === 'Escape') { setCollectionOpen(false); setInfoOpen(false); setShortcutsOpen(false); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleFileLoad = useCallback((file: File, har: any) => {
    harData.loadHar(file, har);
    setResult(null);
    setError(null);
    setProxyResponse(null);
    setEditedCurl(null);
  }, [harData]);

  const handleAnalyze = useCallback(async (description: string) => {
    if (!harData.file) return;
    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    setProxyResponse(null);
    setEditedCurl(null);

    try {
      const formData = new FormData();
      formData.append('file', harData.file);
      formData.append('description', description);

      const res = await fetch('http://localhost:3001/api/analyze', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `Server error: ${res.status}`);
      }

      const data: AnalysisResult = await res.json();
      setPipelineStep(4);
      setResult(data);

      // For large files that skipped client-side parsing, populate
      // the inspector table from the backend's allRequests response.
      if (harData.entries.length === 0 && data.allRequests?.length > 0) {
        harData.loadEntries(data.allRequests);
      }

      setTimeout(() => {
        document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

      // Auto-save to collection
      saveToCollection({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        description,
        curl: data.curl,
        matchedRequest: {
          method: data.matchedRequest.method,
          url: data.matchedRequest.url,
          status: data.matchedRequest.status,
        },
        confidence: data.confidence,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsAnalyzing(false);
    }
  }, [harData.file, harData.entries.length, harData.loadEntries]);

  const handleExecute = useCallback(async () => {
    if (!result) return;
    setIsExecuting(true);
    setProxyResponse(null);

    try {
      const res = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curl: activeCurl }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Proxy error: ${res.status}`);
      }

      const data: ProxyResponse = await res.json();
      setProxyResponse(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsExecuting(false);
    }
  }, [result, activeCurl]);

  const handleCollectionSelect = useCallback((item: CollectionItem) => {
    // Restore a saved item — show as result without re-analyzing
    setResult({
      curl: item.curl,
      matchedRequest: { ...item.matchedRequest, contentType: '' },
      confidence: item.confidence,
      reason: 'Restored from history',
      topMatches: [],
      stats: {
        totalRequests: 0, filteredRequests: 0, uniqueRequests: 0,
        promptTokens: 0, completionTokens: 0, cost: 0,
        processingTime: { total: 0, parsing: 0, llm: 0 },
      },
      allRequests: [],
    });
    setProxyResponse(null);
    setEditedCurl(null);
    setError(null);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      {/* Sticky nav */}
      <header className="sticky top-0 z-50 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
            <Braces className="h-4 w-4" />
            <span className="font-semibold text-sm">HAR Reverse Engineer</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 px-0"
              onClick={() => setCollectionOpen(true)}
              title="History (H)"
            >
              <History className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 px-0"
              onClick={() => setInfoOpen(true)}
              title="Tech Info (I)"
            >
              <Info className="h-4 w-4" />
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="sm" className="h-8 w-8 px-0" asChild>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer">
                <Github className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
          {/* Hero + How it works (before HAR loaded) */}
          {!harData.hasData && (
            <div className="space-y-6">
              <div className="text-center space-y-2 py-4">
                <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  Reverse engineer any API from your browser
                </h1>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-lg mx-auto">
                  Upload a HAR file, describe what you&apos;re looking for, and get a ready-to-use curl command. Powered by an 8-layer filtering pipeline and AI matching.
                </p>
              </div>
              <HowItWorks />
            </div>
          )}

          {/* Step 1: Upload */}
          <Card className="animate-fade-in-up">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {harData.hasData ? 'HAR File' : '1. Upload HAR File'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FileUpload onFileLoad={handleFileLoad} isLoading={isAnalyzing} />
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-zinc-200 dark:border-zinc-800" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white dark:bg-zinc-900 px-2 text-zinc-400 dark:text-zinc-500">or auto-capture from URL</span>
                </div>
              </div>
              <AutoCapture onFileLoad={handleFileLoad} isLoading={isAnalyzing} />
            </CardContent>
          </Card>

          {/* Empty state: capability stats + tips */}
          {!harData.hasData && (
            <div className="space-y-4 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-3">Tips</p>
                  <ul className="space-y-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <li className="flex gap-2">
                      <span className="shrink-0">1.</span>
                      <span>Open DevTools &rarr; Network tab &rarr; right-click &rarr; <strong className="text-zinc-700 dark:text-zinc-300">Export HAR with content</strong></span>
                    </li>
                    <li className="flex gap-2">
                      <span className="shrink-0">2.</span>
                      <span>Be specific: &ldquo;Spotify playlist fetch API&rdquo; &gt; &ldquo;playlist&rdquo;</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="shrink-0">3.</span>
                      <span>Analytics, tracking, and CDN requests are auto-filtered</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="shrink-0">4.</span>
                      <span>Press <kbd suppressHydrationWarning className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-800 rounded text-[10px] font-mono">{typeof window !== 'undefined' && /Mac/.test(navigator.userAgent) ? '\u2318' : 'Ctrl+'}Enter</kbd> for quick analyze</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step 2: Inspect */}
          {harData.hasData && (
            <Card className="animate-fade-in-up" style={{ animationDelay: '100ms' }}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">2. HAR Inspector</CardTitle>
                  <Badge variant="outline">{harData.entries.length > 0 ? `${harData.entries.length} requests` : 'large file'}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {harData.entries.length > 0 ? (
                  <HarInspector entries={harData.entries} matchedIndex={result?.topMatches?.[0]?.index} />
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-4">
                    Large file — inspector will populate after analysis
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step 3: Describe */}
          {harData.hasData && (
            <Card className="animate-fade-in-up" style={{ animationDelay: '200ms' }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">3. Describe the API</CardTitle>
              </CardHeader>
              <CardContent>
                <DescriptionInput
                  onAnalyze={handleAnalyze}
                  isLoading={isAnalyzing}
                  disabled={!harData.hasData}
                />
              </CardContent>
            </Card>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-4">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Loading: pipeline stepper */}
          {isAnalyzing && <PipelineStepper currentStep={pipelineStep} />}

          {/* Results */}
          {result && (
            <div id="results-section" className="space-y-4 animate-fade-in-up">
              <PipelineStats stats={result.stats} />
              <CurlOutput
                curl={activeCurl}
                confidence={activeConfidence}
                reason={activeReason}
                type={result.type}
                provider={result.provider}
                model={result.model}
                matchedRequest={result.matchedRequest}
                topMatches={result.topMatches}
                onExecute={handleExecute}
                isExecuting={isExecuting}
                onCurlChange={setEditedCurl}
                onSelectMatch={(match) => {
                  const idx = result.topMatches.findIndex((m) => m.index === match.index);
                  if (idx >= 0) {
                    setSelectedMatchIndex(idx);
                    setEditedCurl(null);
                    setProxyResponse(null);
                  }
                }}
              />
            </div>
          )}

          {/* Loading skeleton during execution */}
          {isExecuting && !proxyResponse && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Executing...</CardTitle>
                  <div className="h-5 w-16 bg-zinc-200 dark:bg-zinc-800 rounded-full animate-pulse" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="bg-zinc-950 p-4 rounded-lg space-y-2">
                  <div className="h-4 w-full bg-zinc-800 rounded animate-pulse" />
                  <div className="h-4 w-4/5 bg-zinc-800 rounded animate-pulse" />
                  <div className="h-4 w-3/5 bg-zinc-800 rounded animate-pulse" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Execution Response: diff view if original available, plain viewer otherwise */}
          {proxyResponse && (
            originalResponse ? (
              <ResponseDiff original={originalResponse} live={proxyResponse} />
            ) : (
              <ResponseViewer response={proxyResponse} />
            )
          )}
        </div>
      </main>

      {/* Collection Sidebar */}
      <CollectionSidebar
        isOpen={collectionOpen}
        onClose={() => setCollectionOpen(false)}
        onSelect={handleCollectionSelect}
      />

      {/* Tech Deep Dive Modal */}
      <TechDeepDive isOpen={infoOpen} onClose={() => setInfoOpen(false)} />

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcuts isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 py-4">
        <div className="max-w-4xl mx-auto px-4 flex items-center justify-between text-xs text-zinc-400 dark:text-zinc-500">
          <span>Built with Next.js, NestJS, and GPT-4o-mini</span>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
