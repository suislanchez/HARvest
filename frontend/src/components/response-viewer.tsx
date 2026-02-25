'use client';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Copy, Check, ChevronsUpDown } from 'lucide-react';

interface ResponseViewerProps {
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    duration: number;
  };
}

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  if (status >= 400 && status < 500) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
  if (status >= 500) return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
  return 'bg-zinc-100 text-zinc-800';
}

function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export function ResponseViewer({ response }: ResponseViewerProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(formatBody(response.body));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Response</CardTitle>
          <div className="flex items-center gap-2">
            <Badge className={statusColor(response.status)}>
              {response.status} {response.statusText}
            </Badge>
            <span className="text-xs text-zinc-500 font-mono">{response.duration}ms</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="body">
          <TabsList className="h-8">
            <TabsTrigger value="body" className="text-xs">Body</TabsTrigger>
            <TabsTrigger value="headers" className="text-xs">Headers</TabsTrigger>
          </TabsList>
          <TabsContent value="body">
            <div className="relative">
              <pre className={`bg-zinc-950 text-zinc-100 p-4 rounded-lg text-sm font-mono overflow-auto whitespace-pre-wrap ${expanded ? '' : 'max-h-[300px]'}`}>
                {formatBody(response.body)}
              </pre>
              <div className="absolute top-2 right-2 flex gap-1">
                <Button size="sm" variant="ghost" onClick={handleCopy} className="h-7 px-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)} className="h-7 px-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="headers">
            <div className="bg-zinc-950 text-zinc-100 p-4 rounded-lg text-sm font-mono overflow-auto max-h-[300px]">
              {Object.entries(response.headers).map(([key, value]) => (
                <div key={key} className="py-0.5">
                  <span className="text-blue-400">{key}</span>: {value}
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
