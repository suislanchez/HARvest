'use client';

import { X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface KeyboardShortcutsProps {
  isOpen: boolean;
  onClose: () => void;
}

const shortcuts = [
  { keys: '?', description: 'Show keyboard shortcuts' },
  { keys: '\u2318 / Ctrl + Enter', description: 'Analyze HAR' },
  { keys: 'H', description: 'Toggle history sidebar' },
  { keys: 'I', description: 'Open tech info panel' },
  { keys: 'Esc', description: 'Close any open panel' },
];

export function KeyboardShortcuts({ isOpen, onClose }: KeyboardShortcutsProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative z-10 w-full max-w-sm animate-scale-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Keyboard Shortcuts</h2>
          <Button variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <CardContent className="p-4">
          <div className="space-y-3">
            {shortcuts.map((s) => (
              <div key={s.keys} className="flex items-center justify-between text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">{s.description}</span>
                <kbd className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs font-mono text-zinc-700 dark:text-zinc-300">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
