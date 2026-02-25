'use client';
import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface DescriptionInputProps {
  onAnalyze: (description: string) => void;
  isLoading: boolean;
  disabled: boolean;
}

export function DescriptionInput({ onAnalyze, isLoading, disabled }: DescriptionInputProps) {
  const [description, setDescription] = useState('');

  const canSubmit = description.trim().length >= 5 && !disabled && !isLoading;

  const handleSubmit = () => {
    if (canSubmit) {
      onAnalyze(description.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const examplePrompts = [
    'The Spotify playlist fetch API',
    'GraphQL query that fetches user profile',
    'The login/authentication endpoint',
    'API that returns search results as JSON',
  ];

  return (
    <div className="space-y-2">
      <Label htmlFor="description">Describe the API you&apos;re looking for</Label>
      {!description && (
        <div className="flex flex-wrap gap-2">
          {examplePrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setDescription(prompt)}
              className="text-xs px-3 py-1 rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}
      <Textarea
        id="description"
        placeholder='e.g., "The weather forecast API that returns JSON data" or "The GraphQL query that fetches user profiles"'
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled || isLoading}
        rows={3}
        className="resize-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          Press {typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent) ? '\u2318' : 'Ctrl+'}Enter to analyze
        </span>
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          size="sm"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Analyzing...
            </span>
          ) : (
            'Analyze HAR'
          )}
        </Button>
      </div>
    </div>
  );
}
