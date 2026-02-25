'use client';
import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Play } from 'lucide-react';
import { CodeBlock } from '@/components/code-block';
import { parseCurl, toPython, toJavaScript, toGo, toRuby } from '@/lib/code-generators';

interface CodeTabsProps {
  curl: string;
  editable?: boolean;
  onCurlChange?: (curl: string) => void;
  onExecute?: () => void;
  isExecuting?: boolean;
}

const TABS = [
  { id: 'curl', label: 'curl' },
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'go', label: 'Go' },
  { id: 'ruby', label: 'Ruby' },
] as const;

type TabId = typeof TABS[number]['id'];

export function CodeTabs({ curl, editable, onCurlChange, onExecute, isExecuting }: CodeTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('curl');

  const parsed = useMemo(() => {
    try {
      return parseCurl(curl);
    } catch {
      return null;
    }
  }, [curl]);

  const generated = useMemo(() => {
    if (!parsed) return { python: '', javascript: '', go: '', ruby: '' };
    return {
      python: toPython(parsed),
      javascript: toJavaScript(parsed),
      go: toGo(parsed),
      ruby: toRuby(parsed),
    };
  }, [parsed]);

  const getCode = (tab: TabId): string => {
    if (tab === 'curl') return curl;
    return generated[tab];
  };

  const executeAction = onExecute ? (
    <Button
      size="sm"
      variant="ghost"
      onClick={onExecute}
      disabled={isExecuting}
      className="h-7 px-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 gap-1"
    >
      <Play className="h-3.5 w-3.5" />
      <span className="text-xs">{isExecuting ? 'Running...' : 'Execute'}</span>
    </Button>
  ) : undefined;

  return (
    <div className="space-y-0">
      <div className="flex items-center gap-0.5 bg-zinc-900 rounded-t-lg px-2 pt-1.5 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
              activeTab === tab.id
                ? 'bg-zinc-950 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <CodeBlock
        code={getCode(activeTab)}
        editable={activeTab === 'curl' && editable}
        onChange={activeTab === 'curl' ? onCurlChange : undefined}
        actions={activeTab === 'curl' ? executeAction : undefined}
        maxHeight="max-h-[400px]"
      />
    </div>
  );
}
