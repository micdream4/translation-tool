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
  const {
    sectionDividerClass,
    headingMutedClass,
    mutedTextClass,
    nestedPanelClass
  } = getUiClasses(isLight);

  return (
    <section
      ref={previewSectionRef}
      className={`overflow-hidden rounded-xl border ${sectionDividerClass}`}
    >
      <div className={`p-4 border-b flex justify-between items-center ${isLight ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800 bg-slate-900/50'}`}>
        <div className="flex items-center gap-4">
          <h2 className={`text-sm font-semibold uppercase ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>{t('preview.title')}</h2>
          {previewData.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={showComparison}
                  onChange={() => setShowComparison(!showComparison)}
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                <span className={`ml-2 text-xs font-medium ${headingMutedClass}`}>{t('preview.verify')}</span>
              </label>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {previewFocus && (
            <div className={`flex items-center gap-2 text-[10px] ${isLight ? 'text-indigo-600' : 'text-indigo-300'}`}>
              <span>{t('preview.focused', { label: formatLocationLabel(previewFocus.rowIndex, previewFocus.columnKey) })}</span>
              <button
                onClick={() => setPreviewFocus(null)}
                className={isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-500 hover:text-slate-300'}
              >
                {t('preview.clearFocus')}
              </button>
            </div>
          )}
          <div className={`text-[10px] ${mutedTextClass}`}>
            {previewData.length > 0
              ? previewFocus
                ? t('preview.showingFocused', { count: previewRowIndices.length })
                : t('preview.showingLast', { shown: Math.min(10, previewData.length), total: previewData.length })
              : t('common.noData')}
          </div>
        </div>
      </div>

      {focusedPreviewCell && (
        <div className={`px-4 py-3 border-b ${isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-950/40'}`}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <p className={`text-[11px] font-semibold uppercase tracking-wider ${isLight ? 'text-indigo-700' : 'text-indigo-300'}`}>
                {t('preview.focusedCell')}
              </p>
              <p className={`text-xs mt-1 ${headingMutedClass}`}>{focusedPreviewCell.locationLabel}</p>
            </div>
            <span className={`text-[10px] ${mutedTextClass}`}>
              {focusedPreviewCell.skipped
                ? t('preview.skippedKept')
                : focusedPreviewCell.changed ? t('preview.changed') : t('preview.identical')}
            </span>
          </div>
          <div className={`grid gap-3 ${showComparison ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
            <div className={nestedPanelClass}>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">{t('preview.target')}</p>
              <p className={`text-sm whitespace-pre-wrap break-words ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                {focusedPreviewCell.translated || t('common.empty')}
              </p>
            </div>
            {showComparison && (
              <div className={nestedPanelClass}>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">{t('preview.source')}</p>
                <p className={`text-sm whitespace-pre-wrap break-words ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                  {focusedPreviewCell.original || t('common.empty')}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={`overflow-auto h-[410px] scrollbar-thin ${isLight ? 'scrollbar-thumb-slate-200' : 'scrollbar-thumb-slate-800'}`}>
        {previewData.length === 0 ? (
          <div className={`h-full flex items-center justify-center text-sm italic ${isLight ? 'text-slate-400' : 'text-slate-600'}`}>
            {t('preview.waiting')}
          </div>
        ) : (
          <table className="w-full text-left border-collapse min-w-full table-fixed">
            <thead className={`sticky top-0 text-[10px] font-semibold uppercase z-10 shadow-sm ${isLight ? 'bg-slate-50 text-slate-500' : 'bg-slate-800 text-slate-400'}`}>
              <tr>
                <th className={`px-4 py-3 border-b w-20 ${isLight ? 'border-slate-200' : 'border-slate-700'}`}>{t('preview.row')}</th>
                {previewColumnKeys.map(key => (
                  <th key={key} className={`px-4 py-3 border-b truncate w-40 ${isLight ? 'border-slate-200' : 'border-slate-700'}`}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody className={isLight ? 'divide-y divide-slate-100' : 'divide-y divide-slate-800'}>
              {previewRowIndices.map((actualIndex) => {
                const record = previewData[actualIndex] || {};
                const originalRecord = previewSourceRows[actualIndex] || {};
                const isFocusedRow = previewFocus?.rowIndex === actualIndex;

                return (
                  <tr
                    key={actualIndex}
                    className={`${isLight ? 'hover:bg-indigo-50/60' : 'hover:bg-slate-800/30'} transition-colors ${isFocusedRow ? 'bg-indigo-500/10' : ''}`}
                  >
                    <td className={`px-4 py-3 border-b text-[11px] text-slate-500 font-mono ${isLight ? 'border-slate-100' : 'border-slate-800/50'}`}>
                      R{formatExcelRowNumber(actualIndex)}
                    </td>
                    {previewColumnKeys.map((key, j) => {
                      const val = record[key];
                      const origVal = originalRecord ? originalRecord[key] : '';
                      const isDiff = hasChanged(origVal, val);
                      const isFocusedCell =
                        previewFocus?.rowIndex === actualIndex && previewFocus.columnKey === key;
                      const isSkippedCell = shouldSkipExcelCell(actualIndex, key);
            
                      return (
                        <td
                          key={j}
                          className={`px-4 py-3 border-b ${isLight ? 'border-slate-100' : 'border-slate-800/50'} ${isFocusedCell ? 'bg-indigo-500/20 ring-1 ring-inset ring-indigo-400' : ''}`}
                        >
                          <div className="flex flex-col gap-0.5">
                            <span
                              title={String(val)}
                              className={`text-xs truncate whitespace-nowrap ${isDiff ? (isLight ? 'text-indigo-700 font-medium' : 'text-indigo-300 font-medium') : (isLight ? 'text-slate-700' : 'text-slate-300')}`}
                            >
                              {String(val)}
                            </span>
                  
                            {showComparison && isDiff && (
                              <span
                                title={String(origVal)}
                                className={`text-[10px] text-slate-500 truncate whitespace-nowrap px-1.5 py-0.5 rounded border w-fit max-w-full ${isLight ? 'bg-white border-slate-200' : 'bg-slate-800/50 border-slate-700/50'}`}
                              >
                                {String(origVal)}
                              </span>
                            )}
                            {isSkippedCell && (
                              <span className={`text-[10px] truncate whitespace-nowrap px-1.5 py-0.5 rounded border w-fit max-w-full ${isLight ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}>
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
    </section>
  );
};

export default PreviewPanel;
