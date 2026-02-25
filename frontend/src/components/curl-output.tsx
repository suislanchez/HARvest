'use client';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CodeTabs } from '@/components/code-tabs';
import { EnvPanel } from '@/components/env-panel';
import { detectSecrets } from '@/lib/env-extractor';

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
  onCurlChange?: (curl: string) => void;
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  if (confidence >= 0.5) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
}

export function CurlOutput({ curl, confidence, reason, matchedRequest, topMatches, onExecute, isExecuting, onCurlChange }: CurlOutputProps) {
  const secrets = useMemo(() => detectSecrets(curl), [curl]);

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
        <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono min-w-0">
          <Badge variant="outline" className="text-xs shrink-0">{matchedRequest.method}</Badge>
          <span className="truncate" title={matchedRequest.url}>{matchedRequest.url}</span>
          <span className="shrink-0">&rarr; {matchedRequest.status}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <CodeTabs
          curl={curl}
          editable
          onCurlChange={onCurlChange}
          onExecute={onExecute}
          isExecuting={isExecuting}
        />

        {secrets.length > 0 && (
          <EnvPanel
            secrets={secrets}
            curl={curl}
            onApply={(parameterized) => onCurlChange?.(parameterized)}
          />
        )}

        {topMatches.length > 1 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-zinc-500">Other matches:</p>
            {topMatches.slice(1).map((match) => (
              <div key={match.index} className="flex items-center gap-2 text-xs text-zinc-400 min-w-0">
                <Badge variant="outline" className="text-[10px] px-1 shrink-0">{match.method}</Badge>
                <span className="font-mono truncate flex-1">{match.url}</span>
                <span className="shrink-0">{Math.round(match.confidence * 100)}%</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
