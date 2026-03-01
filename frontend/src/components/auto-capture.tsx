'use client';

import { useState, useCallback, useRef } from 'react';
import { Globe, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AutoCaptureProps {
  onFileLoad: (file: File, har: any) => void;
  isLoading: boolean;
}

const CAPTURE_STEPS = [
  { key: 'launching', label: 'Launching browser...' },
  { key: 'navigating', label: 'Navigating to site...' },
  { key: 'recording', label: 'Recording network traffic...' },
  { key: 'processing', label: 'Processing HAR file...' },
];

export function AutoCapture({ onFileLoad, isLoading }: AutoCaptureProps) {
  const [url, setUrl] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stepIndex = currentStep
    ? CAPTURE_STEPS.findIndex((s) => s.key === currentStep)
    : -1;

  const handleCapture = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    // Add protocol if missing
    const captureUrl =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`;

    setIsCapturing(true);
    setError(null);
    setCurrentStep(null);
    setDone(false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('http://localhost:3001/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: captureUrl }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ') && currentEvent) {
            const data = JSON.parse(line.slice(6));

            if (currentEvent === 'progress') {
              setCurrentStep(data.step);
            } else if (currentEvent === 'complete') {
              setDone(true);
              // Create a File object from the HAR data and feed into existing pipeline
              const harJson = JSON.parse(data.har);
              const blob = new Blob([data.har], { type: 'application/json' });
              const file = new File([blob], data.filename, {
                type: 'application/json',
              });
              onFileLoad(file, harJson);
            } else if (currentEvent === 'error') {
              throw new Error(data.message);
            }

            currentEvent = '';
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message);
      }
    } finally {
      setIsCapturing(false);
      abortRef.current = null;
    }
  }, [url, onFileLoad]);

  const disabled = isLoading || isCapturing;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !disabled && url.trim()) {
              handleCapture();
            }
          }}
        />
        <Button
          onClick={handleCapture}
          disabled={disabled || !url.trim()}
          className="shrink-0"
        >
          <Globe className="h-4 w-4 mr-1.5" />
          Capture
        </Button>
      </div>

      {/* Progress stepper */}
      {(isCapturing || done) && (
        <div className="space-y-2 pl-1">
          {CAPTURE_STEPS.map((step, i) => {
            const isDone = done || i < stepIndex;
            const isCurrent = !done && i === stepIndex;
            const isPending = !done && i > stepIndex;
            return (
              <div key={step.key} className="flex items-center gap-2.5">
                {isDone ? (
                  <div className="h-4 w-4 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[10px]">
                    &#10003;
                  </div>
                ) : isCurrent ? (
                  <div className="h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                ) : (
                  <div className="h-4 w-4 rounded-full border-2 border-zinc-300 dark:border-zinc-700" />
                )}
                <span
                  className={`text-xs ${
                    isCurrent
                      ? 'text-zinc-900 dark:text-zinc-100 font-medium'
                      : isDone
                        ? 'text-zinc-500 dark:text-zinc-400'
                        : isPending
                          ? 'text-zinc-400 dark:text-zinc-600'
                          : ''
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Error with retry */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <span className="flex-1">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCapture}
            className="shrink-0 h-7 text-xs"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
