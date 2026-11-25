/* Red Wyvern UI Kit — AG Grid theme (gridTheme + Thai locale).
   Usage (vanilla): agGrid.createGrid(el, { theme: window.UIKIT.gridTheme(), localeText: window.UIKIT.gridLocale, ... })
   Usage (React):   port gridTheme()/gridLocale to a TS module with the same params */
(function () {
  function gridTheme() {
    return agGrid.themeQuartz.withParams({
      accentColor: 'var(--cui-primary)',
      foregroundColor: 'var(--x-ink)',
      backgroundColor: '#fff',
      headerBackgroundColor: 'var(--x-surface-sunk)',
      headerTextColor: 'var(--x-ink-soft)',
      headerFontWeight: 700,
      headerFontSize: 13,
      headerHeight: 46,
      rowHeight: 72,           // list pages with two-line cells; use 48 for dense tables
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
  var gridLocale = {
    page: 'หน้า', of: 'จาก', to: 'ถึง', more: 'มากกว่า',
    firstPage: 'หน้าแรก', previousPage: 'หน้าก่อน', nextPage: 'หน้าถัดไป', lastPage: 'หน้าสุดท้าย',
    pageSizeSelectorLabel: 'แสดงหน้าละ', ariaPageSizeSelectorLabel: 'แสดงหน้าละ', pageLastRowUnknown: '?',
    loadingOoo: 'กำลังโหลด…', loadingError: 'โหลดข้อมูลไม่สำเร็จ', noRowsToShow: 'ไม่มีข้อมูล',
  };
  var defaultColDef = { sortable: true, filter: false, resizable: true, suppressMovable: true, flex: 1, minWidth: 90 };
  var PAGE_SIZES = [20, 50, 100];
  window.UIKIT = Object.assign(window.UIKIT || {}, {
    gridTheme: gridTheme, gridLocale: gridLocale, defaultColDef: defaultColDef, PAGE_SIZES: PAGE_SIZES,
  });
})();
