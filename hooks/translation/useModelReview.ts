
import React from 'react';
import type { ModelReviewStyleSelection } from '../../components/translator/types';
import { ModelReviewService } from '../../services/modelReviewService';
import {
  POCTRecord
} from '../../types';
import {
  getDocxSegmentText,
  type DocxContext
} from '../../utils/docx';
import {
  DEFAULT_MODEL_REVIEW_JUDGE_MODELS,
  DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS,
  MODEL_REVIEW_STYLE_LABELS,
  formatModelReviewReport,
  type ModelReviewResult,
  type ModelReviewSample,
  type ModelReviewStyle
} from '../../utils/modelReview';
import {
  getPdfSegmentText,
  type PdfContext
} from '../../utils/pdf';
import {
  normalizeMemorySource
} from '../../utils/translationMemory';
import {
  downloadTextFile,
  getModelLabel,
  shouldLockCell
} from '../../utils/translatorShared';

export interface ModelReviewContext {
  addLog: (msg: string) => void;
  data: POCTRecord[];
  documentKind: "excel" | "docx" | "pdf";
  docxContextRef: React.RefObject<DocxContext>;
  isRunningModelReview: boolean;
  modelReviewCount: number;
  modelReviewResult: ModelReviewResult;
  modelReviewService: ModelReviewService;
  modelReviewStyleSelection: ModelReviewStyleSelection;
  pdfContextRef: React.RefObject<PdfContext>;
  setIsRunningModelReview: React.Dispatch<React.SetStateAction<boolean>>;
  setModelReviewResult: React.Dispatch<React.SetStateAction<ModelReviewResult>>;
  setModelReviewStatus: React.Dispatch<React.SetStateAction<{ stage: "idle" | "sampling" | "translating" | "judging" | "completed" | "error"; message: string; }>>;
  shouldSkipExcelCell: (rowIndex: number, columnKey: string) => boolean;
  shouldTranslateDocxText: (text: string) => boolean;
  shouldTranslateValue: (value: unknown, key?: string) => boolean;
  targetLang: string;
  translationStatus: "idle" | "completed" | "running" | "paused";
}

export const useModelReview = (ctx: ModelReviewContext) => {
  const {
    addLog,
    data,
    documentKind,
    docxContextRef,
    isRunningModelReview,
    modelReviewCount,
    modelReviewResult,
    modelReviewService,
    modelReviewStyleSelection,
    pdfContextRef,
    setIsRunningModelReview,
    setModelReviewResult,
    setModelReviewStatus,
    shouldSkipExcelCell,
    shouldTranslateDocxText,
    shouldTranslateValue,
    targetLang,
    translationStatus
  } = ctx;

  const buildTextSegmentModelReviewSamples = (
    segments: Array<{ id: string; original: string }>,
    readText: (segment: any) => string,
    sourceLabel: string,
    limit: number
  ): ModelReviewSample[] => {
    const candidates = segments
      .map((segment, index) => ({
        segment,
        index,
        text: (readText(segment) || segment.original || '').replace(/\s+/g, ' ').trim()
      }))
      .filter((item) => item.text && shouldTranslateDocxText(item.text));
    const selected: typeof candidates = [];
    const need = Math.min(limit, candidates.length);
    if (need <= 0) return [];
    const step = Math.max(1, Math.floor(candidates.length / need));
    for (let i = 0; i < candidates.length && selected.length < need; i += step) {
      selected.push(candidates[i]);
    }
    for (const item of candidates) {
      if (selected.length >= need) break;
      if (!selected.some((selectedItem) => selectedItem.index === item.index)) {
        selected.push(item);
      }
    }
    return selected.map((item) => {
      const contextBefore = segments
        .slice(Math.max(0, item.index - 2), item.index)
        .map((segment) => (readText(segment) || segment.original || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const contextAfter = segments
        .slice(item.index + 1, item.index + 3)
        .map((segment) => (readText(segment) || segment.original || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      return {
        id: item.segment.id,
        location: `${sourceLabel} #${item.index + 1}`,
        sourceText: item.text,
        contextBefore,
        contextAfter
      };
    });
  };

const buildExcelModelReviewSamples = (limit: number): ModelReviewSample[] => {
    const cells: ModelReviewSample[] = [];
    const seen = new Set<string>();
    data.forEach((row, rowIndex) => {
      Object.entries(row).forEach(([key, value]) => {
        if (shouldSkipExcelCell(rowIndex, key)) return;
        if (typeof value !== 'string') return;
        const text = value.replace(/\s+/g, ' ').trim();
        if (!text || shouldLockCell(key, value) || !shouldTranslateValue(value, key)) return;
        const memoryKey = `${key}\u0000${normalizeMemorySource(text)}`;
        if (seen.has(memoryKey)) return;
        seen.add(memoryKey);
        cells.push({
          id: `excel-${rowIndex}-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`,
          location: `Excel row ${rowIndex + 1} · ${key}`,
          sourceText: text
        });
      });
    });
    if (cells.length <= limit) return cells;
    const selected: ModelReviewSample[] = [];
    const step = Math.max(1, Math.floor(cells.length / limit));
    for (let i = 0; i < cells.length && selected.length < limit; i += step) {
      selected.push(cells[i]);
    }
    return selected;
  };

const buildModelReviewSamples = (limit: number = modelReviewCount): ModelReviewSample[] => {
    if (documentKind === 'excel') {
      return buildExcelModelReviewSamples(limit);
    }
    if (documentKind === 'docx' && docxContextRef.current) {
      return buildTextSegmentModelReviewSamples(
        docxContextRef.current.segments,
        (segment) => getDocxSegmentText(segment),
        'DOCX Segment',
        limit
      );
    }
    if (documentKind === 'pdf' && pdfContextRef.current) {
      return buildTextSegmentModelReviewSamples(
        pdfContextRef.current.segments,
        (segment) => getPdfSegmentText(segment),
        'PDF Segment',
        limit
      );
    }
    return [];
  };

const canRunModelReview = () => {
    if (documentKind === 'excel') return data.length > 0;
    if (documentKind === 'docx') return docxContextRef.current !== null;
    if (documentKind === 'pdf') return pdfContextRef.current !== null;
    return false;
  };

const getRecommendedModelReviewStyle = (): ModelReviewStyle => {
    if (documentKind === 'excel') return 'medical-report';
    if (documentKind === 'docx') return 'ifu-manual';
    return 'auto';
  };

const getEffectiveModelReviewStyle = (): ModelReviewStyle =>
    modelReviewStyleSelection === 'recommended'
      ? getRecommendedModelReviewStyle()
      : modelReviewStyleSelection;

const runModelReview = async () => {
    if (!canRunModelReview()) {
      addLog('Multi-AI Review: 请先上传可抽样的 Excel、DOCX 或 PDF 文档。');
      setModelReviewStatus({ stage: 'error', message: '请先在 Translator 页面上传并解析文件。' });
      return;
    }
    if (isRunningModelReview || translationStatus === 'running') {
      addLog('Multi-AI Review: 当前有任务正在运行，请稍后再试。');
      setModelReviewStatus({ stage: 'error', message: '当前有任务正在运行，请稍后再试。' });
      return;
    }
    setModelReviewStatus({ stage: 'sampling', message: `Sampling ${getModelReviewSourceLabel()}...` });
    const samples = buildModelReviewSamples(modelReviewCount);
    if (!samples.length) {
      addLog('Multi-AI Review: 当前文档中没有可抽样的源语言文本。');
      setModelReviewStatus({ stage: 'error', message: '当前文档中没有可抽样的源语言文本。' });
      return;
    }
    setIsRunningModelReview(true);
    setModelReviewResult(null);
    const reviewStyle = getEffectiveModelReviewStyle();
    setModelReviewStatus({
      stage: 'translating',
      message: `Translating ${samples.length} samples with ${DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS.length} candidate models...`
    });
	    addLog(
	      `Multi-AI Review: 抽取 ${samples.length} 个 ${getModelReviewSourceLabel()}，评审风格 ${MODEL_REVIEW_STYLE_LABELS[reviewStyle]}，调用 ${DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS.length} 个候选模型和 ${DEFAULT_MODEL_REVIEW_JUDGE_MODELS.length} 个匿名评审模型；后端按保守并发执行。`
	    );
    try {
      window.setTimeout(() => {
        setModelReviewStatus((current) =>
          current.stage === 'translating'
            ? {
                stage: 'judging',
                message: `Anonymous judges are scoring candidate translations...`
              }
            : current
        );
      }, 1200);
      const result = await modelReviewService.reviewModels({
        samples,
        targetLang,
        translationModels: DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS,
        judgeModels: DEFAULT_MODEL_REVIEW_JUDGE_MODELS,
        reviewStyle,
        profile: documentKind === 'excel' ? 'spreadsheet' : 'docx-manual'
      });
      setModelReviewResult(result);
      const successfulCandidates = result.candidates.filter((candidate) => candidate.translations.length > 0);
      const failedCandidates = result.candidates.filter((candidate) => candidate.error);
      const failedJudges = result.judges.filter((judge) => judge.error || judge.scores.length === 0);
      failedCandidates.forEach((candidate) => {
        addLog(`Multi-AI Review: 候选模型失败 ${candidate.model} - ${candidate.error || 'no translations returned'}`);
      });
      failedJudges.forEach((judge) => {
        addLog(`Multi-AI Review: 匿名评审失败 ${judge.model} - ${judge.error || 'no scores returned'}`);
      });
      const top = result.ranking[0];
      if (top && top.judgeCount > 0) {
        addLog(`Multi-AI Review: 完成，当前最高分 ${top.model} (${top.overall.toFixed(2)})。`);
        setModelReviewStatus({
          stage: 'completed',
          message: `Completed. Top model: ${getModelLabel(top.model)} (${top.overall.toFixed(2)}).`
        });
      } else if (successfulCandidates.length) {
        addLog(
          `Multi-AI Review: 候选翻译完成 ${successfulCandidates.length}/${result.candidates.length}，但匿名评审没有返回有效分数。`
        );
        setModelReviewStatus({
          stage: 'completed',
          message: `Translations completed for ${successfulCandidates.length}/${result.candidates.length} candidate models, but judges returned no usable scores.`
        });
      } else {
        addLog('Multi-AI Review: 完成，但评审模型未返回有效排名。');
        setModelReviewStatus({
          stage: 'completed',
          message: 'Completed, but no valid ranking was returned by the judges.'
        });
      }
    } catch (error) {
      addLog(`Multi-AI Review: ${error instanceof Error ? error.message : String(error)}`);
      setModelReviewStatus({
        stage: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setIsRunningModelReview(false);
    }
  };

const exportModelReviewReport = () => {
    if (!modelReviewResult) {
      addLog('Multi-AI Review: 当前没有可导出的评审报告。');
      return;
    }
    const safeStamp = modelReviewResult.createdAt.replace(/[:.]/g, '-');
    downloadTextFile(
      `Multi_AI_Review_${documentKind}_${targetLang}_${safeStamp}.md`,
      formatModelReviewReport(modelReviewResult)
    );
    addLog('Multi-AI Review: 已导出 Markdown 评审报告。');
  };

const getModelReviewSourceLabel = () => {
    if (documentKind === 'excel') return 'Excel cells';
    if (documentKind === 'docx') return 'DOCX segments';
    if (documentKind === 'pdf') return 'PDF text segments';
    return 'current document';
  };

  return {
    buildModelReviewSamples,
    canRunModelReview,
    getRecommendedModelReviewStyle,
    getEffectiveModelReviewStyle,
    runModelReview,
    exportModelReviewReport,
    getModelReviewSourceLabel
  };
};
