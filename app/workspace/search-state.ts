import type { SearchSort } from './search-grid';

export const emptySearch = { q: '', year: '', type: '', from: '', to: '', requester: '' };
export type SearchState = { filters: typeof emptySearch; page: number; pageSize: number; ordering: SearchSort };
/** Home-page sections; each keeps its own query-string namespace. */
export type SearchScope = 'mine' | 'department';
export const scopePrefix: Record<SearchScope, string> = { mine: 'm_', department: 'd_' };

export function readSearchState(params: URLSearchParams, prefix = ''): SearchState {
  const value = (key: string) => params.getAll(prefix + key).length === 1 ? params.get(prefix + key) : null;
  const filters = { ...emptySearch };
  for (const key of Object.keys(filters) as (keyof typeof filters)[]) filters[key] = value(key) ?? '';
  const rawPage = value('page') ?? '1';
  const page = /^[1-9]\d{0,4}$/.test(rawPage) && Number(rawPage) <= 10000 ? Number(rawPage) : 1;
  const size = Number(value('pageSize') ?? 20);
  const sort = value('sort') ?? 'documentDate';
  const direction = value('direction') ?? 'desc';
  return { filters, page, pageSize: [20, 50, 100].includes(size) ? size : 20,
    ordering: { sort: ['number', 'documentDate', 'subject', 'ownerId', 'type'].includes(sort) ? sort as SearchSort['sort'] : 'documentDate', direction: direction === 'asc' ? 'asc' : 'desc' } };
}

/** Writes one section's state into `base`, keeping the other section's keys. */
export function searchStateUrl({ filters, page, pageSize, ordering }: SearchState, prefix = '', base?: URLSearchParams) {
  const params = new URLSearchParams(base);
  for (const key of [...params.keys()]) if (key.startsWith(prefix)) params.delete(key);
  const isDefault = page === 1 && pageSize === 20 && ordering.sort === 'documentDate' && ordering.direction === 'desc' && !Object.values(filters).some(Boolean);
  if (!isDefault) {
    for (const [key, value] of Object.entries({ page: String(page), pageSize: String(pageSize), ...ordering })) params.set(prefix + key, value);
    for (const [key, value] of Object.entries(filters)) if (value.trim()) params.set(prefix + key, value.trim());
  }
  const query = params.toString();
  return query ? `/workspace?${query}` : '/workspace';
}
