'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Copy, Check, Play } from 'lucide-react';

interface MatchInfo {
  index: number;
  confidence: number;
  reason: string;
  method: string;
  url: string;
}

interface CurlOutputProps {
  curl: string;
  confidence: number;
  reason: string;
  matchedRequest: {
    method: string;
    url: string;
    status: number;
    contentType: string;
  };
  topMatches: MatchInfo[];
  onExecute?: () => void;
  isExecuting?: boolean;
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  if (confidence >= 0.5) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
}

export function CurlOutput({ curl, confidence, reason, matchedRequest, topMatches, onExecute, isExecuting }: CurlOutputProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(curl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Result</CardTitle>
          <Badge className={confidenceColor(confidence)}>
            {Math.round(confidence * 100)}% confidence
          </Badge>
        </div>
        <p className="text-sm text-zinc-500">{reason}</p>
        <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
          <Badge variant="outline" className="text-xs">{matchedRequest.method}</Badge>
          <span className="truncate">{matchedRequest.url}</span>
          <span>&rarr; {matchedRequest.status}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <pre className="bg-zinc-950 text-zinc-100 p-4 rounded-lg text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all">
            {curl}
          </pre>
          <div className="absolute top-2 right-2 flex gap-1">
            <Button size="sm" variant="ghost" onClick={handleCopy} className="h-7 px-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
            {onExecute && (
              <Button size="sm" variant="ghost" onClick={onExecute} disabled={isExecuting} className="h-7 px-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {topMatches.length > 1 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-zinc-500">Other matches:</p>
            {topMatches.slice(1).map((match) => (
              <div key={match.index} className="flex items-center gap-2 text-xs text-zinc-400">
                <Badge variant="outline" className="text-[10px] px-1">{match.method}</Badge>
                <span className="font-mono truncate flex-1">{match.url}</span>
                <span>{Math.round(match.confidence * 100)}%</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
