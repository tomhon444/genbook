import { themeQuartz, type ColDef } from 'ag-grid-community';

// Red Wyvern UI Kit grid standard (node_modules/red-wyvern-ui-kit/docs/data-grid.md,
// web/assets/js/grid-theme.js). Keep the params in sync with the kit.
export function gridTheme() {
  return themeQuartz.withParams({
    accentColor: 'var(--cui-primary)',
    foregroundColor: 'var(--x-ink)',
    backgroundColor: '#fff',
    headerBackgroundColor: 'var(--x-surface-sunk)',
    headerTextColor: 'var(--x-ink-soft)',
    headerFontWeight: 700,
    headerFontSize: 13,
    headerHeight: 46,
    rowHeight: 72,
    rowHoverColor: '#fafbfc',
    selectedRowBackgroundColor: 'var(--cui-primary-bg-subtle)',
    borderColor: 'var(--x-line)',
    rowBorder: { color: 'var(--x-line)' },
    columnBorder: false,
    headerColumnBorder: false,
    pinnedColumnBorder: false,
    headerColumnResizeHandleColor: 'var(--x-line-strong)',
    wrapperBorder: false,
    wrapperBorderRadius: 0,
    borderRadius: 7,
    cellHorizontalPadding: 16,
    fontFamily: 'inherit',
    fontSize: 15,
  });
}

export const gridLocale: Record<string, string> = {
  page: 'หน้า', of: 'จาก', to: 'ถึง', more: 'มากกว่า',
  firstPage: 'หน้าแรก', previousPage: 'หน้าก่อน', nextPage: 'หน้าถัดไป', lastPage: 'หน้าสุดท้าย',
  pageSizeSelectorLabel: 'แสดงหน้าละ', ariaPageSizeSelectorLabel: 'แสดงหน้าละ', pageLastRowUnknown: '?',
  loadingOoo: 'กำลังโหลด…', loadingError: 'โหลดข้อมูลไม่สำเร็จ', noRowsToShow: 'ไม่มีข้อมูล',
  ariaLabelColumnMenu: 'เมนูคอลัมน์', ariaLabelSortAscending: 'เรียงจากน้อยไปมาก', ariaLabelSortDescending: 'เรียงจากมากไปน้อย',
};

export const defaultColDef: ColDef = { sortable: true, filter: false, resizable: true, suppressMovable: true, flex: 1, minWidth: 90 };

export const PAGE_SIZES = [20, 50, 100] as const;
