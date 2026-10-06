
import React from 'react';
import type { TranslationRequest } from '../../services/translationHub';
import { TranslationHub } from '../../services/translationHub';
import {
  POCTRecord,
  TargetLanguage
} from '../../types';
import { polishTranslation } from '../../utils/postprocess';
import { appendStringHistory,clearStringHistory,loadStringHistory } from '../../utils/stringHistory';
import {
  extractStructuredStringContent,
  guardMarkupTags,
  guardStringResourceTokens,
  isLikelyDateFormatPattern,
  isXmlCommentLine,
  localizeDateFormatPattern,
  parseStringResourceLine,
  restoreMarkupTags,
  restoreStringResourceTokens
} from '../../utils/stringResources';
import { normalizeTerminology } from '../../utils/terminology';
import type {
  StringOutputDiagnostic
} from '../../utils/translatorShared';
import {
  AUTO_MODEL,
  STRING_BATCH_SIZE,
  downloadTextFile,
  formatCurrentStringOutputText,
  formatStringHistoryText,
  getModelLabel
} from '../../utils/translatorShared';

export interface StringResourcesContext {
  addLog: (msg: string) => void;
  applyStringAutoFix: (text: string) => string;
  collectStringOutputDiagnostics: (sourceEntries: ReturnType<typeof parseStringResourceLine>[], output: string, lang: TargetLanguage) => StringOutputDiagnostic;
  currentModelDisplayLabel: string;
  getCurrentStringOutputDiagnostics: (outputs: Record<string, string>) => StringOutputDiagnostic[];
  getTranslationOptions: () => TranslationRequest['options'];
  selectedStringTargetLangs: string[];
  setStringError: React.Dispatch<React.SetStateAction<string>>;
  setStringErrorDetails: React.Dispatch<React.SetStateAction<string>>;
  setStringHistoryCount: React.Dispatch<React.SetStateAction<number>>;
  setStringInput: React.Dispatch<React.SetStateAction<string>>;
  setStringOutputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setStringQualitySummary: React.Dispatch<React.SetStateAction<string>>;
  setStringStatus: React.Dispatch<React.SetStateAction<"idle" | "running" | "completed" | "error">>;
  stringAutoFix: boolean;
  stringInput: string;
  stringOutputs: Record<string, string>;
  translationHub: TranslationHub;
  translationModelPreference: string;
}

export const useStringResources = (ctx: StringResourcesContext) => {
  const {
    addLog,
    applyStringAutoFix,
    collectStringOutputDiagnostics,
    currentModelDisplayLabel,
    getCurrentStringOutputDiagnostics,
    getTranslationOptions,
    selectedStringTargetLangs,
    setStringError,
    setStringErrorDetails,
    setStringHistoryCount,
    setStringInput,
    setStringOutputs,
    setStringQualitySummary,
    setStringStatus,
    stringAutoFix,
    stringInput,
    stringOutputs,
    translationHub,
    translationModelPreference
  } = ctx;

  const translateStringResources = async () => {
    const input = stringInput;
    const targetLangs = selectedStringTargetLangs;
    if (!input.trim()) {
      setStringOutputs({});
      setStringStatus('idle');
      setStringError(null);
      setStringQualitySummary(null);
      setStringErrorDetails(null);
      return;
    }

    const lineBreak = input.includes('\r\n') ? '\r\n' : '\n';
    const hasTrailingNewline = input.endsWith('\n');
    const lines = input.split(/\r?\n/);
    const entries = lines.map(parseStringResourceLine);
    const hasTranslatableEntries = entries.some(
      (entry, index) => !isXmlCommentLine(lines[index] || '') && entry.needsTranslation
    );
    const localPatternCount = entries.filter(
      (entry, index) =>
        !isXmlCommentLine(lines[index] || '') &&
        entry.needsTranslation &&
        isLikelyDateFormatPattern(
          extractStructuredStringContent(entry.content).translatableContent
        )
    ).length;
    const placeholderStore = new Map<number, Record<string, string> | null>();
    const markupStore = new Map<number, Record<string, string> | null>();
    const indexMap = new Map<number, number>();
    const payload: POCTRecord[] = [];

    entries.forEach((entry, index) => {
      if (isXmlCommentLine(lines[index] || '')) return;
      if (!entry.needsTranslation) return;
      const structured = extractStructuredStringContent(entry.content);
      if (isLikelyDateFormatPattern(structured.translatableContent)) return;
      const { sanitized: markupSanitized, placeholders: markupPlaceholders } =
        guardMarkupTags(structured.translatableContent);
      const { sanitized, placeholders } = guardStringResourceTokens(markupSanitized);
      placeholderStore.set(index, placeholders || null);
      markupStore.set(index, markupPlaceholders || null);
      indexMap.set(index, payload.length);
      payload.push({ content: sanitized });
    });

    const buildOutput = (translatedBatch: POCTRecord[], lang: TargetLanguage) => {
      const mergedLines = entries.map((entry, index) => {
        if (isXmlCommentLine(lines[index] || '')) {
          return entry.original;
        }
        if (!entry.needsTranslation) {
          return entry.original;
        }
        const structured = extractStructuredStringContent(entry.content);
        if (isLikelyDateFormatPattern(structured.translatableContent)) {
          return `${entry.prefix}${structured.outerPrefix}${localizeDateFormatPattern(
            structured.translatableContent,
            lang
          )}${structured.outerSuffix}${entry.suffix}`;
        }
        const batchIndex = indexMap.get(index);
        const translatedRecord =
          typeof batchIndex === 'number' ? translatedBatch[batchIndex] || {} : {};
        const candidate =
          typeof translatedRecord.content === 'string'
            ? translatedRecord.content
            : structured.translatableContent;
        const placeholders = placeholderStore.get(index);
        const markupPlaceholders = markupStore.get(index);
        const restored = restoreStringResourceTokens(candidate, placeholders);
        const restoredMarkup = restoreMarkupTags(restored, markupPlaceholders);
        const polished = polishTranslation(
          structured.translatableContent || '',
          stringAutoFix ? applyStringAutoFix(restoredMarkup) : restoredMarkup,
          lang
        );
        const normalized = normalizeTerminology(
          { content: polished },
          lang,
          { content: structured.translatableContent }
        );
        const normalizedContent =
          typeof normalized.content === 'string' ? normalized.content : polished;
        return `${entry.prefix}${structured.outerPrefix}${normalizedContent}${structured.outerSuffix}${entry.suffix}`;
      });
      return mergedLines.join(lineBreak) + (hasTrailingNewline ? lineBreak : '');
    };

    if (!hasTranslatableEntries) {
      addLog(
        `String Resource: 未检测到需要翻译的中文词条，直接输出 ${targetLangs.length} 个目标结果。`
      );
      const outputs: Record<string, string> = {};
      targetLangs.forEach((lang) => {
        outputs[lang] = input;
      });
      setStringOutputs(outputs);
      const entry = {
        id: `str-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
        source: input,
        outputs
      };
      const updated = appendStringHistory(entry);
      setStringHistoryCount(updated.length);
      setStringStatus('completed');
      setStringError(null);
      return;
    }

    setStringStatus('running');
    setStringOutputs({});
    setStringError(null);
    setStringQualitySummary(null);
    setStringErrorDetails(null);
    addLog(
      `String Resource: 开始处理 ${entries.length} 行，输出 ${targetLangs.length} 个目标语言（${targetLangs.join(', ')}）。`
    );
    addLog(`String Resource: 使用上方翻译模型 - ${currentModelDisplayLabel}。`);
    if (payload.length > 0) {
      addLog(
        `String Resource: ${payload.length} 行送模型翻译，按 ${Math.ceil(
          payload.length / STRING_BATCH_SIZE
        )} 批执行。`
      );
    }
    if (localPatternCount > 0) {
      addLog(`String Resource: ${localPatternCount} 行日期/时间格式模板走本地转换。`);
    }

    let completedLangCount = 0;
    const totalLangCount = targetLangs.length;
    const results: Array<PromiseSettledResult<string>> = [];
    for (const lang of targetLangs) {
      addLog(`String Resource: ${lang} 开始处理...`);
      try {
        if (payload.length === 0) {
          const output = buildOutput([], lang);
          setStringOutputs((prev) => ({ ...prev, [lang]: output }));
          completedLangCount += 1;
          addLog(`String Resource: ${lang} 已完成（${completedLangCount}/${totalLangCount}）。`);
          results.push({ status: 'fulfilled', value: output });
          continue;
        }
        const translatedBatch: POCTRecord[] = Array.from({ length: payload.length }, () => ({ content: '' }));
        const totalBatches = Math.ceil(payload.length / STRING_BATCH_SIZE);

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
          const start = batchIndex * STRING_BATCH_SIZE;
          const end = Math.min(payload.length, start + STRING_BATCH_SIZE);
          addLog(
            `String Resource: ${lang} Batch ${batchIndex + 1}/${totalBatches}（第 ${start + 1}-${end} 行）...`
          );
          const batchRecords = payload.slice(start, end);
          const batchResult = await translationHub.translateBatch({
            records: batchRecords,
            targetLang: lang,
            options: getTranslationOptions()
          });
          batchResult.forEach((record, offset) => {
            translatedBatch[start + offset] = record;
          });
          const partialOutput = buildOutput(translatedBatch, lang);
          setStringOutputs((prev) => ({ ...prev, [lang]: partialOutput }));
          addLog(
            `String Resource: ${lang} Batch ${batchIndex + 1}/${totalBatches} 已完成（${end}/${payload.length} 行）。`
          );
        }

        const output = buildOutput(translatedBatch, lang);
        completedLangCount += 1;
        addLog(`String Resource: ${lang} 已完成（${completedLangCount}/${totalLangCount}）。`);
        results.push({ status: 'fulfilled', value: output });
      } catch (error) {
        completedLangCount += 1;
        const reason = error instanceof Error ? error.message : String(error);
        addLog(`String Resource: ${lang} 失败（${completedLangCount}/${totalLangCount}）：${reason}`);
        results.push({ status: 'rejected', reason: error });
      }
    }

    const outputs: Record<string, string> = {};
    const failed: string[] = [];
    const failureDetails: string[] = [];
    results.forEach((result, index) => {
      const lang = targetLangs[index];
      if (result.status === 'fulfilled') {
        outputs[lang] = result.value;
      } else {
        failed.push(lang);
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failureDetails.push(`${lang}: ${reason}`);
      }
    });
    targetLangs.forEach((lang) => {
      if (outputs[lang] === undefined) {
        outputs[lang] = '';
      }
    });

    setStringOutputs(outputs);
    const diagnostics = targetLangs
      .map((lang) => {
        const output = outputs[lang] || '';
        if (!output.trim()) return null;
        return collectStringOutputDiagnostics(entries, output, lang);
      })
      .filter((item): item is StringOutputDiagnostic => Boolean(item));
    const qualityIssues: string[] = [];
    const blockingDiagnostics = diagnostics.filter(
      (item) => item.placeholderLeaks > 0 || item.invalidXml
    );

    diagnostics.forEach(({ lang, untranslated, placeholderLeaks, spacingIssues, invalidXml }) => {
      const parts: string[] = [];
      if (untranslated > 0) parts.push(`未翻译 ${untranslated}`);
      if (placeholderLeaks > 0) parts.push(`占位符 ${placeholderLeaks}`);
      if (spacingIssues > 0) parts.push(`空格异常 ${spacingIssues}`);
      if (invalidXml) parts.push('XML 非法');
      if (parts.length > 0) {
        qualityIssues.push(`${lang}: ${parts.join('，')}`);
      }
    });
    if (qualityIssues.length > 0) {
      const summaryText = `质量检查：${qualityIssues.join('；')}。`;
      setStringQualitySummary(summaryText);
      addLog(summaryText);
    }

    const hasContent = Object.values(outputs).some((value) => value && value.trim());
    if (hasContent && blockingDiagnostics.length === 0 && failed.length === 0) {
      const entry = {
        id: `str-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
        source: input,
        outputs
      };
      const updated = appendStringHistory(entry);
      setStringHistoryCount(updated.length);
    }

    if (failed.length > 0) {
      setStringStatus('error');
      setStringError(`翻译失败：${failed.join(', ')}`);
      if (failureDetails.length > 0) {
        setStringErrorDetails(failureDetails.slice(0, 4).join(' | '));
      }
      addLog(`String Resource: 处理结束，失败语言 ${failed.join(', ')}。`);
    } else if (blockingDiagnostics.length > 0) {
      setStringStatus('error');
      setStringError('字符串结果存在结构风险，已禁止导出。');
      setStringErrorDetails(
        blockingDiagnostics
          .slice(0, 3)
          .map((item) =>
            item.invalidXml
              ? `${item.lang}: XML 校验失败`
              : `${item.lang}: 内部占位符未恢复`
          )
          .join(' | ')
      );
      blockingDiagnostics.forEach((item) => {
        if (item.invalidXml && item.xmlError) {
          addLog(`String Resource: ${item.lang} XML 校验失败 - ${item.xmlError}`);
        } else if (item.placeholderLeaks > 0) {
          addLog(`String Resource: ${item.lang} 检测到 ${item.placeholderLeaks} 个内部占位符残留。`);
        }
      });
    } else {
      setStringStatus('completed');
      setStringError(null);
      setStringErrorDetails(null);
      addLog(`String Resource: 全部 ${targetLangs.length} 个目标语言处理完成。`);
    }
  };

const clearStringResources = () => {
    setStringInput('');
    setStringOutputs({});
    setStringStatus('idle');
    setStringError(null);
    setStringQualitySummary(null);
    setStringErrorDetails(null);
  };

const copyStringOutput = async (lang: TargetLanguage) => {
    const text = stringOutputs[lang] || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      addLog(`已复制 ${lang} 翻译结果到剪贴板。`);
    } catch (err) {
      addLog(`复制失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

const exportStringHistory = () => {
    const history = loadStringHistory();
    if (history.length === 0) {
      addLog('暂无字符串翻译记录可导出。');
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const content = formatStringHistoryText(history);
    downloadTextFile(`String_Translation_History_${stamp}.txt`, content);
    addLog(`已导出字符串翻译记录（TXT）：${history.length} 条。`);
  };

const exportCurrentStringOutput = () => {
    const availableOutputs: Record<string, string> = Object.fromEntries(
      Object.entries(stringOutputs).filter(([, value]) => String(value || '').trim())
    ) as Record<string, string>;
    if (!Object.keys(availableOutputs).length) {
      addLog('当前没有字符串翻译结果可导出。');
      return;
    }
    const diagnostics = getCurrentStringOutputDiagnostics(availableOutputs);
    const blockingDiagnostics = diagnostics.filter(
      (item) => item.placeholderLeaks > 0 || item.invalidXml
    );
    if (blockingDiagnostics.length > 0) {
      setStringStatus('error');
      setStringError('当前字符串结果未通过结构校验，已禁止导出。');
      setStringErrorDetails(
        blockingDiagnostics
          .slice(0, 3)
          .map((item) =>
            item.invalidXml
              ? `${item.lang}: XML 校验失败`
              : `${item.lang}: 内部占位符未恢复`
          )
          .join(' | ')
      );
      blockingDiagnostics.forEach((item) => {
        if (item.invalidXml && item.xmlError) {
          addLog(`String Resource: ${item.lang} 导出前 XML 校验失败 - ${item.xmlError}`);
        } else if (item.placeholderLeaks > 0) {
          addLog(`String Resource: ${item.lang} 导出前检测到 ${item.placeholderLeaks} 个内部占位符残留。`);
        }
      });
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const content = formatCurrentStringOutputText(stringInput, availableOutputs);
    downloadTextFile(`String_Translation_Current_${stamp}.txt`, content);
    addLog(`已导出当前字符串翻译结果（TXT）：${Object.keys(availableOutputs).join(', ')}。`);
  };

const clearStringHistoryData = () => {
    clearStringHistory();
    setStringHistoryCount(0);
    addLog('已清空字符串翻译记录。');
  };

  return {
    translateStringResources,
    clearStringResources,
    copyStringOutput,
    exportStringHistory,
    exportCurrentStringOutput,
    clearStringHistoryData
  };
};
