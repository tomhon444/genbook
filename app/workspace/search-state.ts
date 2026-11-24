import type { SearchSort } from './search-grid';

export const emptySearch = { q: '', year: '', type: '', from: '', to: '', requester: '' };
export type SearchState = { filters: typeof emptySearch; page: number; pageSize: number; ordering: SearchSort };

export function readSearchState(params: URLSearchParams): SearchState {
  const value = (key: string) => params.getAll(key).length === 1 ? params.get(key) : null;
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

export function searchStateUrl({ filters, page, pageSize, ordering }: SearchState) {
  if (page === 1 && pageSize === 20 && ordering.sort === 'documentDate' && ordering.direction === 'desc' && !Object.values(filters).some(Boolean)) return '/workspace';
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...ordering });
  for (const [key, value] of Object.entries(filters)) if (value.trim()) params.set(key, value.trim());
  return `/workspace?${params}`;
}
