'use client';
import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { DetectedSecret, parameterize } from '@/lib/env-extractor';

interface EnvPanelProps {
  secrets: DetectedSecret[];
  curl: string;
  onApply: (parameterizedCurl: string) => void;
}

export function EnvPanel({ secrets, curl, onApply }: EnvPanelProps) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(secrets.map((s) => [s.value, true]))
  );
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(secrets.map((s) => [s.value, s.name]))
  );
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [applied, setApplied] = useState(false);

  const activeReplacements = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of secrets) {
      if (enabled[s.value]) {
        map.set(s.value, names[s.value] || s.name);
      }
    }
    return map;
  }, [secrets, enabled, names]);

  const parameterizedCurl = useMemo(
    () => parameterize(curl, activeReplacements),
    [curl, activeReplacements],
  );

  const envFileContent = useMemo(() => {
    return secrets
      .filter((s) => enabled[s.value])
      .map((s) => `${names[s.value] || s.name}=${s.value}`)
      .join('\n');
  }, [secrets, enabled, names]);

  const handleApply = () => {
    onApply(parameterizedCurl);
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  };

  const handleCopyEnv = async () => {
    await navigator.clipboard.writeText(envFileContent);
    setCopiedEnv(true);
    setTimeout(() => setCopiedEnv(false), 2000);
  };

  const mask = (value: string) => value.substring(0, 4) + '•'.repeat(Math.min(value.length - 4, 20));

  if (secrets.length === 0) return null;

  return (
    <div className="border border-amber-200 dark:border-amber-900/50 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-200 dark:border-amber-900/50">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
          {secrets.length} secret{secrets.length > 1 ? 's' : ''} detected
        </span>
      </div>

      <div className="p-3 space-y-2">
        {secrets.map((secret) => (
          <div key={secret.value} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={enabled[secret.value] ?? true}
              onChange={(e) => setEnabled({ ...enabled, [secret.value]: e.target.checked })}
              className="rounded border-zinc-300"
            />
            <input
              value={names[secret.value] || secret.name}
              onChange={(e) => setNames({ ...names, [secret.value]: e.target.value })}
              className="w-32 px-1.5 py-0.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs font-mono"
            />
            <span className="text-zinc-500">=</span>
            <span className="font-mono text-zinc-600 dark:text-zinc-400 truncate flex-1">
              {revealed[secret.value] ? secret.value : mask(secret.value)}
            </span>
            <button
              onClick={() => setRevealed({ ...revealed, [secret.value]: !revealed[secret.value] })}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              {revealed[secret.value] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
            <Badge variant="outline" className="text-[10px] px-1">{secret.location}</Badge>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-amber-200 dark:border-amber-900/50">
        <Button size="sm" variant="outline" className="text-xs h-7" onClick={handleApply}>
          {applied ? 'Applied!' : 'Apply to curl'}
        </Button>
        <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={handleCopyEnv}>
          {copiedEnv ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          Copy .env
        </Button>
      </div>
    </div>
  );
}
