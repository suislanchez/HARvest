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

  const handleSubmit = () => {
    if (description.trim().length >= 5) {
      onAnalyze(description.trim());
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="description">Describe the API you&apos;re looking for</Label>
      <Textarea
        id="description"
        placeholder='e.g., "The weather forecast API that returns JSON data" or "The GraphQL query that fetches user profiles"'
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={disabled || isLoading}
        rows={3}
        className="resize-none"
      />
      <Button
        onClick={handleSubmit}
        disabled={disabled || isLoading || description.trim().length < 5}
        className="w-full"
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
  );
}
