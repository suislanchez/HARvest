'use client';
import { useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ChevronUp, ChevronDown, Search } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

export interface HarEntry {
  method: string;
  url: string;
  status: number;
  contentType: string;
  time: number;
}

interface HarEntryWithIndex extends HarEntry {
  originalIndex: number;
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

function SortIcon({ direction }: { direction: false | 'asc' | 'desc' }) {
  if (direction === 'asc') return <ChevronUp className="inline h-3 w-3 ml-0.5" />;
  if (direction === 'desc') return <ChevronDown className="inline h-3 w-3 ml-0.5" />;
  return null;
}

export function HarInspector({ entries, matchedIndex }: HarInspectorProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const dataWithIndex = useMemo<HarEntryWithIndex[]>(
    () => entries.map((e, i) => ({ ...e, originalIndex: i })),
    [entries],
  );

  const columns = useMemo<ColumnDef<HarEntryWithIndex>[]>(() => [
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
    data: dataWithIndex,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, filterValue) => {
      return row.original.url.toLowerCase().includes(filterValue.toLowerCase());
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500 text-sm">
        Upload a HAR file to inspect requests
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
        <Input
          placeholder="Filter by URL..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>
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
                    <SortIcon direction={header.column.getIsSorted()} />
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className={row.original.originalIndex === matchedIndex ? 'bg-blue-50 dark:bg-blue-950/30' : ''}
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
    </div>
  );
}
