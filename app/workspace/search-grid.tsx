"use client";

import { useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, themeQuartz, type ColDef, type GridApi, type ICellRendererParams } from 'ag-grid-community';

export type SearchDocument = { kind: string; snapshot: string; id: string; number: string; numberYear: number; type: string; subject: string; documentDate: string; ownerId: string };
export type SearchSort = { sort: 'number' | 'documentDate' | 'subject' | 'ownerId' | 'type'; direction: 'asc' | 'desc' };
const modules = [AllCommunityModule];
const theme = themeQuartz.withParams({
  fontFamily: 'var(--cui-body-font-family)', fontSize: 17, headerFontSize: 17,
  foregroundColor: '#172b42', backgroundColor: '#ffffff', accentColor: '#b53639',
  borderColor: '#d6e0ea', headerBackgroundColor: '#f4f7f9', oddRowBackgroundColor: '#fafafa',
  wrapperBorderRadius: 0, headerHeight: 48,
});
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
    { field: 'number', headerName: 'เลขหนังสือ / ปี', initialWidth: 240,
      cellRenderer: ({ data }: ICellRendererParams<SearchDocument>) => data && <button className="document-number search-number-link" type="button" disabled={pending} aria-label={`${data.number} · ปี ${data.numberYear} · ${data.subject}`} onClick={() => onOpen(data)}>{data.number} · ปี {data.numberYear}</button>,
      suppressKeyboardEvent: ({ event }) => event.key === 'Tab' && event.target instanceof HTMLButtonElement,
    },
    { field: 'documentDate', headerName: 'วันที่หนังสือ', initialWidth: 160,
      valueFormatter: ({ value }) => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value ?? '';
        const [year, month, day] = value.split('-');
        return `${day}-${month}-${Number(year) + 543}`;
      },
    },
    { field: 'subject', headerName: 'เรื่อง', minWidth: 260, initialFlex: 1 },
    { colId: 'actions', headerName: 'รายละเอียด', initialWidth: 150, minWidth: 150, sortable: false, resizable: false,
      cellRenderer: ({ data }: ICellRendererParams<SearchDocument>) => data && <button className="search-detail-action" type="button" disabled={pending} aria-label={`ดูรายละเอียด ${data.number}`} onClick={() => onOpen(data)}>ดูรายละเอียด</button>,
    },
  ], [onOpen, pending]);

  return <div className="search-grid" role="region" aria-label="รายการหนังสือ" aria-busy={pending}>
    <AgGridReact<SearchDocument> modules={modules} theme={theme} rowData={documents} columnDefs={columns}
      defaultColDef={defaults} domLayout="autoHeight" rowHeight={60} suppressMultiSort enableCellTextSelection ensureDomOrder
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
      localeText={{ noRowsToShow: 'ไม่พบหนังสือ', loadingOoo: 'กำลังโหลด…', ariaLabelColumnMenu: 'เมนูคอลัมน์', ariaLabelSortAscending: 'เรียงจากน้อยไปมาก', ariaLabelSortDescending: 'เรียงจากมากไปน้อย' }}
    />
  </div>;
}
