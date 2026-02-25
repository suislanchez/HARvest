'use client';
import { useState, useCallback } from 'react';

export interface ProxyResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
}

export function useApiExecutor() {
  const [response, setResponse] = useState<ProxyResponse | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (curl: string) => {
    setIsExecuting(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curl }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Proxy error: ${res.status}`);
      }

      const data: ProxyResponse = await res.json();
      setResponse(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsExecuting(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResponse(null);
    setError(null);
  }, []);

  return { response, isExecuting, error, execute, reset };
}
