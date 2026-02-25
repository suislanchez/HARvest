'use client';

import { useState } from 'react';
import { FileUpload } from '@/components/file-upload';
import { HarInspector } from '@/components/har-inspector';
import { DescriptionInput } from '@/components/description-input';
import { CurlOutput } from '@/components/curl-output';
import { ResponseViewer } from '@/components/response-viewer';
import { useHarData } from '@/hooks/use-har-data';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface AnalysisResult {
  curl: string;
  matchedRequest: { method: string; url: string; status: number; contentType: string };
  confidence: number;
  reason: string;
  topMatches: Array<{ index: number; confidence: number; reason: string; method: string; url: string }>;
  stats: { totalRequests: number; filteredRequests: number; tokenEstimate: number };
  allRequests: Array<{ method: string; url: string; status: number; contentType: string; time: number }>;
}

interface ProxyResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
}

export default function Home() {
  const harData = useHarData();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proxyResponse, setProxyResponse] = useState<ProxyResponse | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const handleFileLoad = (file: File, har: any) => {
    harData.loadHar(file, har);
    setResult(null);
    setError(null);
    setProxyResponse(null);
  };

  const handleAnalyze = async (description: string) => {
    if (!harData.file) return;
    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    setProxyResponse(null);

    try {
      const formData = new FormData();
      formData.append('file', harData.file);
      formData.append('description', description);

      const res = await fetch('http://localhost:3001/api/analyze', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `Server error: ${res.status}`);
      }

      const data: AnalysisResult = await res.json();
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExecute = async () => {
    if (!result) return;
    setIsExecuting(true);
    setProxyResponse(null);

    try {
      const res = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curl: result.curl }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Proxy error: ${res.status}`);
      }

      const data: ProxyResponse = await res.json();
      setProxyResponse(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            HAR Reverse Engineer
          </h1>
          <p className="text-sm text-zinc-500">
            Upload a HAR file, describe an API, get a curl command
          </p>
        </div>

        {/* Step 1: Upload */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">1. Upload HAR File</CardTitle>
          </CardHeader>
          <CardContent>
            <FileUpload onFileLoad={handleFileLoad} isLoading={isAnalyzing} />
          </CardContent>
        </Card>

        {/* Step 2: Inspect (shown after upload) */}
        {harData.hasData && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">2. HAR Inspector</CardTitle>
                <Badge variant="outline">{harData.entries.length} requests</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <HarInspector entries={harData.entries} matchedIndex={result?.topMatches?.[0]?.index} />
            </CardContent>
          </Card>
        )}

        {/* Step 3: Describe (shown after upload) */}
        {harData.hasData && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">3. Describe the API</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionInput
                onAnalyze={handleAnalyze}
                isLoading={isAnalyzing}
                disabled={!harData.hasData}
              />
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-4">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Step 4: Results */}
        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>Filtered {result.stats.filteredRequests} API requests from {result.stats.totalRequests} total</span>
              <span>&middot;</span>
              <span>~{result.stats.tokenEstimate} tokens</span>
            </div>
            <CurlOutput
              curl={result.curl}
              confidence={result.confidence}
              reason={result.reason}
              matchedRequest={result.matchedRequest}
              topMatches={result.topMatches}
              onExecute={handleExecute}
              isExecuting={isExecuting}
            />
          </div>
        )}

        {/* Step 5: Execution Response */}
        {proxyResponse && <ResponseViewer response={proxyResponse} />}
      </div>
    </main>
  );
}
