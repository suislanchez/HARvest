'use client';
import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Copy, Check, ChevronsUpDown } from 'lucide-react';

interface ResponseDiffProps {
  original: string | null;
  live: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    duration: number;
  } | null;
}

function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

interface DiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
}

function computeDiff(a: string, b: string): DiffLine[] {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const result: DiffLine[] = [];
  const max = Math.max(linesA.length, linesB.length);

  for (let i = 0; i < max; i++) {
    const la = i < linesA.length ? linesA[i] : undefined;
    const lb = i < linesB.length ? linesB[i] : undefined;

    if (la === lb) {
      result.push({ type: 'same', text: la! });
    } else {
      if (la !== undefined) result.push({ type: 'removed', text: la });
      if (lb !== undefined) result.push({ type: 'added', text: lb });
    }
  }
  return result;
}

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  if (status >= 400 && status < 500) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
  if (status >= 500) return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
  return 'bg-zinc-100 text-zinc-800';
}

function DiffView({ original, live }: { original: string; live: string }) {
  const diff = useMemo(() => computeDiff(formatBody(original), formatBody(live)), [original, live]);

  return (
    <pre className="bg-zinc-950 text-zinc-100 p-4 rounded-lg text-sm font-mono overflow-auto max-h-[400px] whitespace-pre-wrap">
      {diff.map((line, i) => (
        <div
          key={i}
          className={
            line.type === 'removed'
              ? 'bg-red-950/40 text-red-300'
              : line.type === 'added'
              ? 'bg-green-950/40 text-green-300'
              : ''
          }
        >
          <span className="select-none text-zinc-600 mr-2">
            {line.type === 'removed' ? '-' : line.type === 'added' ? '+' : ' '}
          </span>
          {line.text}
        </div>
      ))}
    </pre>
  );
}

export function ResponseDiff({ original, live }: ResponseDiffProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<'diff' | 'side-by-side'>('diff');

  if (!live) return null;

  const liveFormatted = formatBody(live.body);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(liveFormatted);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasBoth = !!original && !!live;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Response</CardTitle>
          <div className="flex items-center gap-2">
            {hasBoth && (
              <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
                <button
                  onClick={() => setView('diff')}
                  className={`px-2 py-0.5 text-xs rounded ${view === 'diff' ? 'bg-white dark:bg-zinc-700 shadow-sm' : 'text-zinc-500'}`}
                >
                  Diff
                </button>
                <button
                  onClick={() => setView('side-by-side')}
                  className={`px-2 py-0.5 text-xs rounded ${view === 'side-by-side' ? 'bg-white dark:bg-zinc-700 shadow-sm' : 'text-zinc-500'}`}
                >
                  Side by Side
                </button>
              </div>
            )}
            <Badge className={statusColor(live.status)}>
              {live.status} {live.statusText}
            </Badge>
            <span className="text-xs text-zinc-500 font-mono">{live.duration}ms</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <div className="absolute top-2 right-2 z-10 flex gap-1">
            <Button size="sm" variant="ghost" onClick={handleCopy} className="h-7 px-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)} className="h-7 px-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
              <ChevronsUpDown className="h-3.5 w-3.5" />
            </Button>
          </div>

          {hasBoth && view === 'diff' ? (
            <DiffView original={original!} live={live.body} />
          ) : hasBoth && view === 'side-by-side' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-zinc-500 mb-1 font-medium">Original (HAR)</div>
                <pre className={`bg-zinc-950 text-zinc-100 p-4 rounded-lg text-sm font-mono overflow-auto whitespace-pre-wrap ${expanded ? '' : 'max-h-[300px]'}`}>
                  {formatBody(original!)}
                </pre>
              </div>
              <div>
                <div className="text-xs text-zinc-500 mb-1 font-medium">Live</div>
                <pre className={`bg-zinc-950 text-zinc-100 p-4 rounded-lg text-sm font-mono overflow-auto whitespace-pre-wrap ${expanded ? '' : 'max-h-[300px]'}`}>
                  {liveFormatted}
                </pre>
              </div>
            </div>
          ) : (
            <pre className={`bg-zinc-950 text-zinc-100 p-4 rounded-lg text-sm font-mono overflow-auto whitespace-pre-wrap ${expanded ? '' : 'max-h-[300px]'}`}>
              {liveFormatted}
            </pre>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
