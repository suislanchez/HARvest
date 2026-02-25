'use client';
import { useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export interface HarEntry {
  method: string;
  url: string;
  status: number;
  contentType: string;
  time: number;
}

interface HarInspectorProps {
  entries: HarEntry[];
  matchedIndex?: number;
}

const methodColors: Record<string, string> = {
  GET: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  POST: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  PUT: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  PATCH: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return 'text-green-600 dark:text-green-400';
  if (status >= 400 && status < 500) return 'text-yellow-600 dark:text-yellow-400';
  if (status >= 500) return 'text-red-600 dark:text-red-400';
  return 'text-zinc-600 dark:text-zinc-400';
}

function truncateUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    return path.length > 60 ? path.substring(0, 57) + '...' : path;
  } catch {
    return url.length > 60 ? url.substring(0, 57) + '...' : url;
  }
}

export function HarInspector({ entries, matchedIndex }: HarInspectorProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo<ColumnDef<HarEntry>[]>(() => [
    {
      accessorKey: 'method',
      header: 'Method',
      size: 80,
      cell: ({ getValue }) => {
        const method = getValue<string>();
        return (
          <Badge variant="outline" className={`font-mono text-xs ${methodColors[method] || ''}`}>
            {method}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'url',
      header: 'URL',
      cell: ({ getValue }) => (
        <span className="font-mono text-xs" title={getValue<string>()}>
          {truncateUrl(getValue<string>())}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      size: 70,
      cell: ({ getValue }) => (
        <span className={`font-mono text-sm font-medium ${statusColor(getValue<number>())}`}>
          {getValue<number>()}
        </span>
      ),
    },
    {
      accessorKey: 'contentType',
      header: 'Type',
      size: 120,
      cell: ({ getValue }) => (
        <span className="text-xs text-zinc-500">{getValue<string>() || '\u2014'}</span>
      ),
    },
    {
      accessorKey: 'time',
      header: 'Time',
      size: 80,
      cell: ({ getValue }) => {
        const ms = getValue<number>();
        return <span className="text-xs text-zinc-500 font-mono">{ms > 0 ? `${Math.round(ms)}ms` : '\u2014'}</span>;
      },
    },
  ], []);

  const table = useReactTable({
    data: entries,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500 text-sm">
        Upload a HAR file to inspect requests
      </div>
    );
  }

  return (
    <div className="rounded-md border dark:border-zinc-800 max-h-[400px] overflow-auto">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className="cursor-pointer select-none text-xs"
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {{ asc: ' \u2191', desc: ' \u2193' }[header.column.getIsSorted() as string] ?? ''}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              className={row.index === matchedIndex ? 'bg-blue-50 dark:bg-blue-950/30' : ''}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="py-1.5">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
