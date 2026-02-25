export interface CollectionItem {
  id: string;
  timestamp: number;
  description: string;
  curl: string;
  matchedRequest: { method: string; url: string; status: number };
  confidence: number;
}

const STORAGE_KEY = 'har-re-collection';
const MAX_ITEMS = 50;

export function getCollection(): CollectionItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveToCollection(item: CollectionItem): void {
  const items = getCollection();
  // Avoid duplicates by curl content
  const existing = items.findIndex((i) => i.curl === item.curl);
  if (existing !== -1) {
    items[existing] = item;
  } else {
    items.unshift(item);
  }
  // FIFO eviction
  if (items.length > MAX_ITEMS) items.length = MAX_ITEMS;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function removeFromCollection(id: string): void {
  const items = getCollection().filter((i) => i.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function clearCollection(): void {
  localStorage.removeItem(STORAGE_KEY);
}
