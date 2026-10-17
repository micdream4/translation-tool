import React from 'react';
import { useI18n } from '../../hooks/useI18n';
import { getUiClasses } from './uiClasses';
import type { POCTRecord } from '../../types';
export interface PreviewPanelProps {
  isLight: boolean;
  focusedPreviewCell: { locationLabel: string; translated: string; original: string; changed: boolean; skipped: boolean; };
  formatExcelRowNumber: (rowIndex: number) => number;
  formatLocationLabel: (rowIndex: number, columnKey: string) => string;
  hasChanged: (orig: any, trans: any) => boolean;
  previewColumnKeys: string[];
  previewData: POCTRecord[];
  previewFocus: { rowIndex: number; columnKey: string; };
  previewRowIndices: number[];
  previewSectionRef: React.RefObject<HTMLElement>;
  previewSourceRows: POCTRecord[];
  setPreviewFocus: React.Dispatch<React.SetStateAction<{ rowIndex: number; columnKey: string; }>>;
  setShowComparison: React.Dispatch<React.SetStateAction<boolean>>;
  shouldSkipExcelCell: (rowIndex: number, columnKey: string) => boolean;
  showComparison: boolean;
}

const PREVIEW_PAGE_SIZE = 10;
const PREVIEW_COLUMN_PAGE_SIZE = 6;

const PreviewPanel: React.FC<PreviewPanelProps> = ({
  isLight,
  focusedPreviewCell,
  formatExcelRowNumber,
  formatLocationLabel,
  hasChanged,
  previewColumnKeys,
  previewData,
  previewFocus,
  previewRowIndices,
  previewSectionRef,
  previewSourceRows,
  setPreviewFocus,
  setShowComparison,
  shouldSkipExcelCell,
  showComparison
}) => {
  const { t } = useI18n();
  const [rowPage, setRowPage] = React.useState(0);
  const [columnPage, setColumnPage] = React.useState(0);
  const focused = Boolean(previewFocus);
  const rowPageCount = Math.max(1, Math.ceil(previewRowIndices.length / PREVIEW_PAGE_SIZE));
  const columnPageCount = Math.max(1, Math.ceil(previewColumnKeys.length / PREVIEW_COLUMN_PAGE_SIZE));
  const safeRowPage = Math.min(rowPage, rowPageCount - 1);
  const safeColumnPage = Math.min(columnPage, columnPageCount - 1);
  const shownRowIndices = focused
    ? previewRowIndices
    : previewRowIndices.slice(safeRowPage * PREVIEW_PAGE_SIZE, (safeRowPage + 1) * PREVIEW_PAGE_SIZE);
  const shownColumnKeys = focused
    ? previewColumnKeys
    : previewColumnKeys.slice(safeColumnPage * PREVIEW_COLUMN_PAGE_SIZE, (safeColumnPage + 1) * PREVIEW_COLUMN_PAGE_SIZE);
  // Duplicate headers are stored as "WBC_1"; show them as "WBC (2)" when the base name exists.
  const displayColumnName = (key: string) => {
    const match = key.match(/^(.*)_(\d+)$/);
    if (match && previewColumnKeys.includes(match[1])) return `${match[1]} (${Number(match[2]) + 1})`;
    return key;
  };
  const {
    sectionDividerClass,
    headingMutedClass,
    mutedTextClass,
    nestedPanelClass
  } = getUiClasses(isLight);

  return (
    <section
      ref={previewSectionRef}
      className={`overflow-hidden rounded-control border ${sectionDividerClass}`}
    >
      <div className={`p-4 border-b flex justify-between items-center ${'border-line bg-sunken/80'}`}>
        <div className="flex items-center gap-4">
          <h2 className={`text-body font-semibold uppercase ${'text-ink'}`}>{t('preview.title')}</h2>
          {previewData.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={showComparison}
                  onChange={() => setShowComparison(!showComparison)}
                />
                <div className="w-9 h-5 bg-strong peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-line after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-line after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                <span className={`ml-2 text-caption font-medium ${headingMutedClass}`}>{t('preview.verify')}</span>
              </label>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {previewFocus && (
            <div className={`flex items-center gap-2 text-caption ${'text-primary-ink'}`}>
              <span>{t('preview.focused', { label: formatLocationLabel(previewFocus.rowIndex, previewFocus.columnKey) })}</span>
              <button
                onClick={() => setPreviewFocus(null)}
                className={'text-muted hover:text-ink'}
              >
                {t('preview.clearFocus')}
              </button>
            </div>
          )}
          <div className={`text-caption ${mutedTextClass}`}>
            {previewData.length > 0
              ? previewFocus
                ? t('preview.showingFocused', { count: previewRowIndices.length })
                : t('preview.showingPage', {
                    from: safeRowPage * PREVIEW_PAGE_SIZE + 1,
                    to: Math.min(previewData.length, (safeRowPage + 1) * PREVIEW_PAGE_SIZE),
                    total: previewData.length
                  })
              : t('common.noData')}
          </div>
        </div>
      </div>

      {focusedPreviewCell && (
        <div className={`px-4 py-3 border-b ${'border-line bg-sunken'}`}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <p className={`text-caption font-semibold uppercase tracking-wider ${'text-primary-ink'}`}>
                {t('preview.focusedCell')}
              </p>
              <p className={`text-caption mt-1 ${headingMutedClass}`}>{focusedPreviewCell.locationLabel}</p>
            </div>
            <span className={`text-caption ${mutedTextClass}`}>
              {focusedPreviewCell.skipped
                ? t('preview.skippedKept')
                : focusedPreviewCell.changed ? t('preview.changed') : t('preview.identical')}
            </span>
          </div>
          <div className={`grid gap-3 ${showComparison ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
            <div className={nestedPanelClass}>
              <p className="text-caption text-muted uppercase tracking-wider mb-2">{t('preview.target')}</p>
              <p className={`text-body whitespace-pre-wrap break-words ${'text-ink'}`}>
                {focusedPreviewCell.translated || t('common.empty')}
              </p>
            </div>
            {showComparison && (
              <div className={nestedPanelClass}>
                <p className="text-caption text-muted uppercase tracking-wider mb-2">{t('preview.source')}</p>
                <p className={`text-body whitespace-pre-wrap break-words ${'text-ink-soft'}`}>
                  {focusedPreviewCell.original || t('common.empty')}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={'overflow-auto h-[410px] scrollbar-thin'}>
        {previewData.length === 0 ? (
          <div className={`h-full flex items-center justify-center text-body italic ${'text-muted'}`}>
            {t('preview.waiting')}
          </div>
        ) : (
          <table className="w-full text-left border-collapse min-w-full table-fixed">
            <thead className={`sticky top-0 text-caption font-semibold uppercase z-10 shadow-sm ${'bg-sunken text-muted'}`}>
              <tr>
                <th className={`px-4 py-3 border-b w-20 ${'border-line'}`}>{t('preview.row')}</th>
                {shownColumnKeys.map(key => (
                  <th key={key} title={key} className={`px-4 py-3 border-b truncate w-40 ${'border-line'}`}>{displayColumnName(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody className={'divide-y divide-line'}>
              {shownRowIndices.map((actualIndex) => {
                const record = previewData[actualIndex] || {};
                const originalRecord = previewSourceRows[actualIndex] || {};
                const isFocusedRow = previewFocus?.rowIndex === actualIndex;

                return (
                  <tr
                    key={actualIndex}
                    className={`${'hover:bg-primary-soft'} transition-colors ${isFocusedRow ? 'bg-primary-soft' : ''}`}
                  >
                    <td className={`px-4 py-3 border-b text-caption text-muted font-mono ${'border-line'}`}>
                      R{formatExcelRowNumber(actualIndex)}
                    </td>
                    {shownColumnKeys.map((key, j) => {
                      const val = record[key];
                      const origVal = originalRecord ? originalRecord[key] : '';
                      const isDiff = hasChanged(origVal, val);
                      const isFocusedCell =
                        previewFocus?.rowIndex === actualIndex && previewFocus.columnKey === key;
                      const isSkippedCell = shouldSkipExcelCell(actualIndex, key);
            
                      return (
                        <td
                          key={j}
                          className={`px-4 py-3 border-b ${'border-line'} ${isFocusedCell ? 'bg-primary-soft ring-1 ring-inset ring-primary' : ''}`}
                        >
                          <div className="flex flex-col gap-0.5">
                            <span
                              title={String(val)}
                              className={`text-caption truncate whitespace-nowrap ${isDiff ? ('text-primary-ink font-medium') : ('text-ink-soft')}`}
                            >
                              {String(val)}
                            </span>
                  
                            {showComparison && isDiff && (
                              <span
                                title={String(origVal)}
                                className={`text-caption text-muted truncate whitespace-nowrap px-2 py-0.5 rounded border w-fit max-w-full ${'bg-surface border-line'}`}
                              >
                                {String(origVal)}
                              </span>
                            )}
                            {isSkippedCell && (
                              <span className={`text-caption truncate whitespace-nowrap px-2 py-0.5 rounded border w-fit max-w-full ${'bg-warning-soft text-warning border-warning-border'}`}>
                                {t('preview.skipped')}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {!focused && previewData.length > 0 && (rowPageCount > 1 || columnPageCount > 1) && (
        <div className={`flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2 text-caption ${sectionDividerClass} ${mutedTextClass}`}>
          <div className="flex items-center gap-2">
            <button type="button" disabled={safeRowPage === 0} onClick={() => setRowPage(safeRowPage - 1)} className="min-h-9 rounded-control px-3 disabled:opacity-40">{t('preview.prev')}</button>
            <span className="tabular-nums">{safeRowPage + 1} / {rowPageCount}</span>
            <button type="button" disabled={safeRowPage >= rowPageCount - 1} onClick={() => setRowPage(safeRowPage + 1)} className="min-h-9 rounded-control px-3 disabled:opacity-40">{t('preview.next')}</button>
          </div>
          {columnPageCount > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" disabled={safeColumnPage === 0} onClick={() => setColumnPage(safeColumnPage - 1)} className="min-h-9 rounded-control px-3 disabled:opacity-40">{t('preview.prevCols')}</button>
              <span className="tabular-nums">{safeColumnPage + 1} / {columnPageCount}</span>
              <button type="button" disabled={safeColumnPage >= columnPageCount - 1} onClick={() => setColumnPage(safeColumnPage + 1)} className="min-h-9 rounded-control px-3 disabled:opacity-40">{t('preview.nextCols')}</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default PreviewPanel;
