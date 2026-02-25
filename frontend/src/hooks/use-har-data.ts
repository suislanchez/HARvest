'use client';
import { useState, useCallback } from 'react';

export interface HarEntry {
  method: string;
  url: string;
  status: number;
  contentType: string;
  time: number;
}

interface HarDataState {
  file: File | null;
  har: any | null;
  entries: HarEntry[];
}

export function useHarData() {
  const [state, setState] = useState<HarDataState>({
    file: null,
    har: null,
    entries: [],
  });

  const loadHar = useCallback((file: File, har: any) => {
    const entries: HarEntry[] = (har.log.entries || []).map((entry: any) => ({
      method: entry.request.method,
      url: entry.request.url,
      status: entry.response.status,
      contentType: (entry.response.content?.mimeType || '').split(';')[0].trim(),
      time: entry.time || 0,
    }));
    setState({ file, har, entries });
  }, []);

  const reset = useCallback(() => {
    setState({ file: null, har: null, entries: [] });
  }, []);

  return {
    ...state,
    loadHar,
    reset,
    hasData: !!state.file,
  };
}
