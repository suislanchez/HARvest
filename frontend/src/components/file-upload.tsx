'use client';
import { useCallback, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';

interface FileUploadProps {
  onFileLoad: (file: File, har: any) => void;
  isLoading: boolean;
}

export function FileUpload({ onFileLoad, isLoading }: FileUploadProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed?.log?.entries) {
        throw new Error('Invalid HAR file: missing log.entries');
      }
      setFileName(file.name);
      onFileLoad(file, parsed);
    } catch (e) {
      setError(e instanceof SyntaxError ? 'Invalid JSON file' : (e as Error).message);
      setFileName(null);
    }
  }, [onFileLoad]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isLoading) return;
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [isLoading, processFile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  }, [processFile]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => !isLoading && inputRef.current?.click()}
      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
        ${isDragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20' : 'border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-600'}
        ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".har,.json"
        onChange={handleChange}
        className="hidden"
      />
      {fileName ? (
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{fileName}</p>
          <p className="text-xs text-zinc-500 mt-1">Drop another file to replace</p>
        </div>
      ) : isDragging ? (
        <p className="text-sm text-blue-600 dark:text-blue-400">Drop your HAR file here...</p>
      ) : (
        <div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Drag &amp; drop a <span className="font-mono">.har</span> file here, or click to browse
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
            Export from browser DevTools → Network → Export HAR
          </p>
        </div>
      )}
      {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
    </div>
  );
}
