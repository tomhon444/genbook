"use client";

import { useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { gridLocale, gridTheme } from '@/lib/grid';
import { AllCommunityModule, type ColDef, type GridApi, type ICellRendererParams } from 'ag-grid-community';
import CIcon from '@coreui/icons-react';
import { cilChevronRight } from '@coreui/icons';
import { FileStatusPill } from './file-status';
import { thaiDate } from './thai-date';

export type SearchDocument = { kind: string; snapshot: string; id: string; number: string; numberYear: number; type: string; subject: string; documentDate: string; ownerId: string;
  confidential?: boolean; cancelled?: boolean; pdfPending?: boolean };
export type SearchSort = { sort: 'number' | 'documentDate' | 'subject' | 'ownerId' | 'type'; direction: 'asc' | 'desc' };
const modules = [AllCommunityModule];
// Kit theme; subjects wrap, so rows grow from the kit's 72px baseline.
const theme = gridTheme();
// The server sorts the entire authorized result before selecting a page.
// Keep that order instead of sorting just the twenty loaded rows in the browser.
const defaults: ColDef<SearchDocument> = {
  sortable: true, resizable: true, suppressMovable: true, suppressHeaderMenuButton: true,
  wrapText: true, autoHeight: true, minWidth: 140, comparator: () => 0,
  sortingOrder: ['asc', 'desc'], cellClass: 'search-grid-cell',
};

export default function SearchGrid({ documents, pending, ordering, onSort, onOpen }: {
  documents: SearchDocument[]; pending: boolean; ordering: SearchSort;
  onSort: (ordering: SearchSort) => void; onOpen: (document: SearchDocument) => void;
}) {
  const api = useRef<GridApi<SearchDocument> | null>(null);
  useEffect(() => {
    api.current?.applyColumnState({ defaultState: { sort: null }, state: [{ colId: ordering.sort, sort: ordering.direction }] });
  }, [ordering]);
  const columns = useMemo<ColDef<SearchDocument>[]>(() => [
    { field: 'number', headerName: 'เลขหนังสือ', initialWidth: 190,
      cellRenderer: ({ data }: ICellRendererParams<SearchDocument>) => data && <button className="document-number search-number-link" type="button" disabled={pending} aria-label={`${data.number} · ปี ${data.numberYear} · ${data.subject}`} onClick={() => onOpen(data)}><strong>{data.number}</strong><small>ปี {data.numberYear}</small></button>,
      suppressKeyboardEvent: ({ event }) => event.key === 'Tab' && event.target instanceof HTMLButtonElement,
    },
    { field: 'documentDate', headerName: 'วันที่', initialWidth: 140,
      valueFormatter: ({ value }) => typeof value === 'string' ? thaiDate(value) : '',
    },
    { field: 'subject', headerName: 'เรื่อง', minWidth: 240, initialFlex: 1, cellClass: 'search-grid-cell search-subject-cell' },
    { colId: 'status', headerName: 'สถานะไฟล์', initialWidth: 150, minWidth: 130, sortable: false,
      cellRenderer: ({ data }: ICellRendererParams<SearchDocument>) => data && <FileStatusPill {...data} />,
    },
    { colId: 'actions', headerName: 'จัดการ', initialWidth: 160, minWidth: 150, sortable: false, resizable: false,
      headerClass: 'search-actions-header', cellClass: 'search-grid-cell search-actions-cell',
      cellRenderer: ({ data }: ICellRendererParams<SearchDocument>) => data && <button className="search-detail-action" type="button" disabled={pending} aria-label={`ดูรายละเอียด ${data.number}`} onClick={() => onOpen(data)}>ดูรายละเอียด<CIcon icon={cilChevronRight} size="sm" aria-hidden="true" /></button>,
    },
  ], [onOpen, pending]);

  return <div className="search-grid" role="region" aria-label="รายการหนังสือ" aria-busy={pending}>
    <AgGridReact<SearchDocument> modules={modules} theme={theme} rowData={documents} columnDefs={columns}
      defaultColDef={defaults} domLayout="autoHeight" rowHeight={72} rowClass="x-row-link"
      onRowClicked={event => { if (event.data && !pending && !(event.event?.target instanceof Element && event.event.target.closest('button'))) onOpen(event.data); }} suppressMultiSort enableCellTextSelection ensureDomOrder
      getRowId={({ data }) => `${data.kind}:${data.snapshot}:${data.id}`}
      onGridReady={event => {
        api.current = event.api;
        event.api.applyColumnState({ defaultState: { sort: null }, state: [{ colId: ordering.sort, sort: ordering.direction }] });
      }}
      onGridPreDestroyed={() => { api.current = null; }}
      onCellKeyDown={event => {
        if ('colDef' in event && event.colDef.field === 'number' && event.event instanceof KeyboardEvent && event.event.target instanceof HTMLElement && !event.event.target.closest('button') && event.event.key === 'Enter' && event.data && !pending) onOpen(event.data);
      }}
      onSortChanged={event => {
        if (event.source === 'api') return;
        const column = event.api.getColumnState().find(column => column.sort);
        if (!column?.sort) return;
        const next = { sort: column.colId as SearchSort['sort'], direction: column.sort };
        if (next.sort !== ordering.sort || next.direction !== ordering.direction) onSort(next);
      }}
      localeText={{ ...gridLocale, noRowsToShow: 'ไม่พบหนังสือ' }}
    />
  </div>;
}
