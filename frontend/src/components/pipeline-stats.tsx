'use client';

import { Card, CardContent } from '@/components/ui/card';

interface PipelineStatsProps {
  stats: {
    totalRequests: number;
    filteredRequests: number;
    uniqueRequests: number;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    processingTime: {
      total: number;
      parsing: number;
      llm: number;
    };
  };
}

export function PipelineStats({ stats }: PipelineStatsProps) {
  const filterPct = stats.totalRequests > 0 ? Math.round((1 - stats.filteredRequests / stats.totalRequests) * 100) : 0;
  const dedupPct = stats.filteredRequests > 0 ? Math.round((1 - stats.uniqueRequests / stats.filteredRequests) * 100) : 0;

  const maxVal = stats.totalRequests;
  const filteredWidth = maxVal > 0 ? (stats.filteredRequests / maxVal) * 100 : 0;
  const uniqueWidth = maxVal > 0 ? (stats.uniqueRequests / maxVal) * 100 : 0;

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-4">
        {/* Funnel visualization */}
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs">
            <span className="w-16 text-right text-zinc-500 shrink-0">Raw</span>
            <div className="flex-1 h-5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-zinc-400 dark:bg-zinc-600 rounded-full animate-bar-fill" style={{ width: '100%' }} />
            </div>
            <span className="w-12 font-mono text-zinc-700 dark:text-zinc-300">{stats.totalRequests.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="w-16 text-right text-zinc-500 shrink-0">Filtered</span>
            <div className="flex-1 h-5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 dark:bg-blue-600 rounded-full animate-bar-fill" style={{ width: `${Math.max(filteredWidth, 2)}%`, animationDelay: '0.2s' }} />
            </div>
            <span className="w-12 font-mono text-zinc-700 dark:text-zinc-300">{stats.filteredRequests.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="w-16 text-right text-zinc-500 shrink-0">Unique</span>
            <div className="flex-1 h-5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 dark:bg-emerald-600 rounded-full animate-bar-fill" style={{ width: `${Math.max(uniqueWidth, 2)}%`, animationDelay: '0.4s' }} />
            </div>
            <span className="w-12 font-mono text-zinc-700 dark:text-zinc-300">{stats.uniqueRequests.toLocaleString()}</span>
          </div>
        </div>

        {/* Metrics row */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400 border-t border-zinc-200 dark:border-zinc-800 pt-3">
          <span>
            <span className="text-zinc-700 dark:text-zinc-300 font-medium">{filterPct}%</span> filtered
          </span>
          {dedupPct > 0 && (
            <span>
              <span className="text-zinc-700 dark:text-zinc-300 font-medium">{dedupPct}%</span> deduped
            </span>
          )}
          <span>
            Prompt: <span className="font-mono text-zinc-700 dark:text-zinc-300">{stats.promptTokens.toLocaleString()}</span> tokens
          </span>
          <span>
            Completion: <span className="font-mono text-zinc-700 dark:text-zinc-300">{stats.completionTokens.toLocaleString()}</span> tokens
          </span>
          <span>
            Cost: <span className="font-mono text-zinc-700 dark:text-zinc-300">${stats.cost < 0.01 ? stats.cost.toFixed(4) : stats.cost.toFixed(2)}</span>
          </span>
        </div>

        {/* Timing */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400 border-t border-zinc-200 dark:border-zinc-800 pt-3">
          <span>
            Parse: <span className="font-mono text-zinc-700 dark:text-zinc-300">{stats.processingTime.parsing}ms</span>
          </span>
          <span>
            LLM: <span className="font-mono text-zinc-700 dark:text-zinc-300">{stats.processingTime.llm.toLocaleString()}ms</span>
          </span>
          <span>
            Total: <span className="font-mono text-zinc-700 dark:text-zinc-300">{stats.processingTime.total.toLocaleString()}ms</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
