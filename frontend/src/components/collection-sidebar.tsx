'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { CollectionItem, getCollection, removeFromCollection, clearCollection } from '@/lib/collection';

interface CollectionSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: CollectionItem) => void;
}

function methodColor(method: string): string {
  const m = method.toUpperCase();
  if (m === 'GET') return 'text-green-400 border-green-400/30';
  if (m === 'POST') return 'text-blue-400 border-blue-400/30';
  if (m === 'PUT') return 'text-yellow-400 border-yellow-400/30';
  if (m === 'DELETE') return 'text-red-400 border-red-400/30';
  return 'text-zinc-400 border-zinc-400/30';
}

function CollectionEntry({ item, onSelect, onRemove }: { item: CollectionItem; onSelect: () => void; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800 last:border-0">
      <div className="flex items-start gap-2 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer" onClick={onSelect}>
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="mt-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <Badge variant="outline" className={`text-[10px] px-1 shrink-0 ${methodColor(item.matchedRequest.method)}`}>
              {item.matchedRequest.method}
            </Badge>
            <span className="text-xs text-zinc-500">{Math.round(item.confidence * 100)}%</span>
          </div>
          <p className="text-xs text-zinc-700 dark:text-zinc-300 truncate">{item.description || 'No description'}</p>
          <p className="text-[10px] text-zinc-400 font-mono truncate mt-0.5">{item.matchedRequest.url}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">{new Date(item.timestamp).toLocaleString()}</p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="text-zinc-400 hover:text-red-500 p-0.5"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3">
          <pre className="bg-zinc-950 text-zinc-100 p-2 rounded text-[11px] font-mono overflow-x-auto whitespace-pre-wrap max-h-[120px]">
            {item.curl}
          </pre>
        </div>
      )}
    </div>
  );
}

export function CollectionSidebar({ isOpen, onClose, onSelect }: CollectionSidebarProps) {
  const [items, setItems] = useState<CollectionItem[]>([]);

  useEffect(() => {
    if (isOpen) setItems(getCollection());
  }, [isOpen]);

  const handleRemove = (id: string) => {
    removeFromCollection(id);
    setItems(getCollection());
  };

  const handleClear = () => {
    clearCollection();
    setItems([]);
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-80 bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 z-50 transform transition-transform duration-200 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-3 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">History</h2>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="overflow-y-auto h-[calc(100%-96px)]">
          {items.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-8">No saved requests yet</p>
          ) : (
            items.map((item) => (
              <CollectionEntry
                key={item.id}
                item={item}
                onSelect={() => { onSelect(item); onClose(); }}
                onRemove={() => handleRemove(item.id)}
              />
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={handleClear}>
              Clear All
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
