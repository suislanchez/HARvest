'use client';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
  editable?: boolean;
  onChange?: (code: string) => void;
  maxHeight?: string;
  actions?: React.ReactNode;
}

export function CodeBlock({ code, language, editable, onChange, maxHeight = 'max-h-[400px]', actions }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    if (editable && textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, [code, editable]);

  return (
    <div className="relative min-w-0 overflow-hidden">
      {language && (
        <div className="absolute top-2 left-3 z-10">
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 uppercase tracking-wider">
            {language}
          </span>
        </div>
      )}
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <Button size="sm" variant="ghost" onClick={handleCopy} className="h-7 px-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
        {actions}
      </div>
      {editable ? (
        <textarea
          ref={textareaRef}
          value={code}
          onChange={(e) => onChange?.(e.target.value)}
          spellCheck={false}
          className={`w-full bg-zinc-950 text-zinc-100 p-4 ${language ? 'pt-9' : ''} rounded-lg text-sm font-mono overflow-auto whitespace-pre resize-none focus:outline-none focus:ring-1 focus:ring-zinc-700 ${maxHeight}`}
        />
      ) : (
        <pre className={`bg-zinc-950 text-zinc-100 p-4 ${language ? 'pt-9' : ''} rounded-lg text-sm font-mono overflow-x-auto whitespace-pre-wrap break-words ${maxHeight}`}>
          {code}
        </pre>
      )}
    </div>
  );
}
