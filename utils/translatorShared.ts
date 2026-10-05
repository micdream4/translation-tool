
import type { DocxIssueDetail } from '../components/translator/types';
import packageJson from '../package.json';
import {
shouldTranslateCellValue
} from '../quality/retryTargets';
import {
POCTRecord,
TargetLanguage,
WorkflowStageState
} from '../types';
import type { UntranslatedCell } from './language';
import { polishTranslation } from './postprocess';
import { type StringTranslationHistoryEntry } from './stringHistory';
import {
STRING_RESOURCE_TARGET_LANGS
} from './targetLanguage';
import { normalizeTerminology } from './terminology';
import {
normalizeOpenRouterModelId
} from './translationProfiles';
import {
isLikelyIdentifier
} from './translationTokens';


export // Batch size kept small for reliability with large column counts
const BATCH_SIZE = 5;
export const DOCX_BATCH_SIZE = 20;
export const DOCX_BATCH_CHAR_LIMIT = 12000;
export const DEEPSEEK_PRO_DOCX_BATCH_SIZE = 8;
export const DEEPSEEK_PRO_DOCX_BATCH_CHAR_LIMIT = 6000;
export const RETRY_BATCH_SIZE = 5;
export const STRING_BATCH_SIZE = 40;
export const SOURCE_LANG_REGEX = /[\u4e00-\u9fff]/;
export const STRING_TARGET_LANGS: TargetLanguage[] = STRING_RESOURCE_TARGET_LANGS;
export const ALL_STRING_TARGETS = '__ALL_STRING_TARGETS__';
export const PROTECTED_TERMS_STORAGE_KEY = 'poct.protected_terms';
export const UI_THEME_STORAGE_KEY = 'poct.ui_theme';
export const TRANSLATION_MEMORY_ENABLED_STORAGE_KEY = 'poct.translation_memory_enabled';
export const PACKAGE_VERSION = String((packageJson as { version?: string }).version || '').trim();
export const APP_VERSION = String((import.meta as any)?.env?.VITE_APP_VERSION || PACKAGE_VERSION).trim();
export const DEFAULT_CLOUDFLARE_AI_MODELS = [
  'google/gemini-3-flash',
  'openai/gpt-5.4',
  'anthropic/claude-sonnet-4.6'
] as const;
export const DEFAULT_OPENROUTER_MODELS: string[] = [];
export const DEFAULT_OPENROUTER_AUTO_MODELS: string[] = [];
export const AUTO_OPENROUTER_MODEL = '__AUTO_OPENROUTER__';
export const OPENROUTER_MODEL_COOLDOWN_MS = 30 * 60 * 1000;
export const MODEL_LABELS: Record<string, string> = {
  'cloudflare-ai:google/gemini-3-flash': 'Cloudflare Gemini 3 Flash',
  'cloudflare-ai:openai/gpt-5.4': 'Cloudflare OpenAI GPT-5.4',
  'cloudflare-ai:anthropic/claude-sonnet-4.6': 'Cloudflare Claude 4.6 Sonnet',
  'deepseek:deepseek-v4-flash': 'DeepSeek Direct v4 Flash',
  'deepseek:deepseek-v4-pro': 'DeepSeek Direct v4 Pro',
  'deepseek-v4-flash': 'DeepSeek Direct v4 Flash',
  'deepseek-v4-pro': 'DeepSeek Direct v4 Pro',
  'google/gemini-3-flash': 'Cloudflare Gemini 3 Flash',
  'openai/gpt-5.4': 'Cloudflare OpenAI GPT-5.4',
  'anthropic/claude-sonnet-4.6': 'Cloudflare Claude 4.6 Sonnet',
  'google/gemini-3-flash-preview': 'Gemini 3 Flash Preview',
  'google/gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview',
  'google/gemini-2.5-pro': 'Gemini 2.5 Pro',
  'qwen/qwen3.6-plus': 'Qwen 3.6 Plus',
  'deepseek/deepseek-v4-pro': 'DeepSeek V4 Pro',
  'openai/gpt-5.3-chat': 'OpenAI GPT-5.3 Chat'
};
export const DEEPSEEK_DIRECT_MODEL = '__DEEPSEEK_DIRECT_FLASH__';
export const DEEPSEEK_DIRECT_PRO_MODEL = '__DEEPSEEK_DIRECT_PRO__';
export const DEEPSEEK_DIRECT_MODEL_LABEL = 'DeepSeek Direct v4 Flash';
export const DEEPSEEK_DIRECT_PRO_MODEL_LABEL = 'DeepSeek Direct v4 Pro';
export const DEEPSEEK_DIRECT_MODEL_PROVIDER_IDS: Record<string, string> = {
  [DEEPSEEK_DIRECT_MODEL]: 'deepseek-v4-flash',
  [DEEPSEEK_DIRECT_PRO_MODEL]: 'deepseek-v4-pro'
};
export const DEEPSEEK_DIRECT_MODEL_VALUES = [DEEPSEEK_DIRECT_MODEL, DEEPSEEK_DIRECT_PRO_MODEL] as const;
export const DEEPSEEK_DIRECT_MODEL_LABELS: Record<string, string> = {
  [DEEPSEEK_DIRECT_MODEL]: DEEPSEEK_DIRECT_MODEL_LABEL,
  [DEEPSEEK_DIRECT_PRO_MODEL]: DEEPSEEK_DIRECT_PRO_MODEL_LABEL
};
export const DEEPSEEK_DIRECT_AUTO_LABELS = [
  DEEPSEEK_DIRECT_MODEL_LABEL,
  DEEPSEEK_DIRECT_PRO_MODEL_LABEL
] as const;
export const CLOUDFLARE_AI_MODEL_VALUE_PREFIX = '__CLOUDFLARE_AI__:';
export const toCloudflareAiModelValue = (model: string) => `${CLOUDFLARE_AI_MODEL_VALUE_PREFIX}${model}`;
export const isCloudflareAiModelValue = (model: string) => model.startsWith(CLOUDFLARE_AI_MODEL_VALUE_PREFIX);
export const getCloudflareAiProviderModel = (model: string) =>
  model.slice(CLOUDFLARE_AI_MODEL_VALUE_PREFIX.length);
export const getModelLabel = (model: string) => MODEL_LABELS[model] || model;
export const getDeepSeekDirectModelLabel = (model: string) => DEEPSEEK_DIRECT_MODEL_LABELS[model] || model;
export const getDeepSeekDirectProviderModel = (model: string) => DEEPSEEK_DIRECT_MODEL_PROVIDER_IDS[model];
export const isDeepSeekDirectModel = (model: string) =>
  Object.prototype.hasOwnProperty.call(DEEPSEEK_DIRECT_MODEL_PROVIDER_IDS, model);
export const isDeepSeekDirectProModel = (model: string) => model === DEEPSEEK_DIRECT_PRO_MODEL;
export const getTranslationModelLabel = (model: string) => {
  if (isDeepSeekDirectModel(model)) return getDeepSeekDirectModelLabel(model);
  if (isCloudflareAiModelValue(model)) return getModelLabel(getCloudflareAiProviderModel(model));
  return getModelLabel(model);
};
export const formatModelChainLabel = (models: readonly string[]) =>
  models.map(getModelLabel).join(' -> ');
export const splitCloudflareAutoModels = (models: readonly string[]) => ({
  primary: models.slice(0, 1),
  fallback: models.slice(1)
});
export const formatAutoModelChainLabel = (
  cloudflareModels: readonly string[],
  openRouterModels: readonly string[],
  includeDeepSeekDirect: boolean
) => {
  const cloudflareAuto = splitCloudflareAutoModels(cloudflareModels);
  return [
    ...cloudflareAuto.primary.map(getModelLabel),
    ...(includeDeepSeekDirect ? DEEPSEEK_DIRECT_AUTO_LABELS : []),
    ...cloudflareAuto.fallback.map(getModelLabel),
    ...openRouterModels.map(getModelLabel)
  ].join(' -> ');
};
export type TranslationEngine = 'cloudflare-ai' | 'openrouter' | 'deepseek' | 'gemini';
export type ThemeMode = 'light' | 'dark';
export type TranslationMemoryStats = {
  hits: number;
  deduped: number;
  stored: number;
};
export type OpenRouterModelCooldown = {
  until: number;
  reason: string;
};
export type OpenRouterModelIssue = {
  model?: string;
  status?: number | string;
  message?: string;
  kind?: string;
};
export type StageResult = 'paused' | 'completed' | void;

export const parseOpenRouterModelOptions = () => {
  const raw =
    String((import.meta as any)?.env?.VITE_OPENROUTER_MODELS || '').trim();
  const values = raw
    ? raw.split(/[,\n;]+/).map((item: string) => normalizeOpenRouterModelId(item)).filter(Boolean)
    : [...DEFAULT_OPENROUTER_MODELS];
  return Array.from(new Set(values));
};

export const parseCloudflareAiModelOptions = () => {
  const raw =
    String((import.meta as any)?.env?.VITE_CLOUDFLARE_AI_MODELS || '').trim();
  const values = raw
    ? raw.split(/[,\n;]+/).map((item: string) => item.trim()).filter(Boolean)
    : [...DEFAULT_CLOUDFLARE_AI_MODELS];
  return Array.from(new Set(values));
};

export const parseOpenRouterAutoModelOptions = () => {
  const raw =
    String((import.meta as any)?.env?.VITE_OPENROUTER_AUTO_MODELS || '').trim();
  const values = raw
    ? raw.split(/[,\n;]+/).map((item: string) => normalizeOpenRouterModelId(item)).filter(Boolean)
    : [...DEFAULT_OPENROUTER_AUTO_MODELS];
  return Array.from(new Set(values));
};

export const parseRuntimeProtectedTerms = (raw: string) =>
  Array.from(
    new Set(
      String(raw || '')
        .split(/[\n;]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );

export const downloadTextFile = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const formatStringHistoryText = (history: StringTranslationHistoryEntry[]) => {
  const separator = '\n' + '='.repeat(80) + '\n';
  return history
    .map((entry, index) => {
      const availableLangs = STRING_TARGET_LANGS.filter((lang) =>
        Object.prototype.hasOwnProperty.call(entry.outputs || {}, lang)
      );
      const langs = availableLangs.length > 0 ? availableLangs : STRING_TARGET_LANGS;
      const lines: string[] = [
        `Record ${index + 1}`,
        `Timestamp: ${new Date(entry.createdAt).toLocaleString()}`,
        '',
        '[Original]',
        entry.source || ''
      ];
      langs.forEach((lang) => {
        lines.push('', `[${lang}]`, entry.outputs[lang] || '');
      });
      return lines.join('\n');
    })
    .join(separator);
};

export const formatCurrentStringOutputText = (
  source: string,
  outputs: Record<string, string>
) => {
  const langs = STRING_TARGET_LANGS.filter((lang) =>
    Boolean(outputs[lang] && outputs[lang].trim())
  );
  const lines: string[] = [
    `Timestamp: ${new Date().toLocaleString()}`,
    '',
    '[Original]',
    source || ''
  ];
  langs.forEach((lang) => {
    lines.push('', `[${lang}]`, outputs[lang] || '');
  });
  return lines.join('\n');
};

export type IssueSummaryState = {
  cells: number;
  rows: number;
  rowIndices: number[];
  missingRows: number[];
  details: UntranslatedCell[];
};


export type StringOutputDiagnostic = {
  lang: TargetLanguage;
  untranslated: number;
  placeholderLeaks: number;
  spacingIssues: number;
  invalidXml: boolean;
  xmlError: string | null;
};

export const isSevereDocxIssue = (issue: DocxIssueDetail) => {
  if (issue.issueType === 'placeholder') return true;
  if (issue.issueType === 'source' && issue.chineseChars >= 2) return true;
  return false;
};

export const createIssueSummary = (): IssueSummaryState => ({
  cells: 0,
  rows: 0,
  rowIndices: [],
  missingRows: [],
  details: []
});

export const DOCX_CHINESE_CHAR_REGEX = /[\u4e00-\u9fff]/g;
export const DOCX_TEXT_CLEANUP_REGEX = /\s+/g;
export const DOCX_WORD_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿÇĞİÖŞÜçğıöşü][A-Za-zÀ-ÖØ-öø-ÿÇĞİÖŞÜçğıöşü0-9-]{0,32}$/;
export const DOCX_PLACEHOLDER_VARIANT_REGEX = /(?:_+)?(?:TKN|ID|FMT)_\d+_+/i;

export const countChineseChars = (text: string) => (text.match(DOCX_CHINESE_CHAR_REGEX) || []).length;

export const toDocxSnippet = (text: string, limit: number = 36) => {
  const normalized = text.replace(DOCX_TEXT_CLEANUP_REGEX, ' ').trim();
  if (!normalized) return '(empty)';
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
};

export const dedupeLeadingRepeat = (source: string, translated: string) => {
  const sourceTrimmed = source.trim();
  const targetTrimmed = translated.trim();
  if (!sourceTrimmed || targetTrimmed.length < 2) return translated;
  const first = targetTrimmed[0];
  const second = targetTrimmed[1];
  if (first.toLowerCase() !== second.toLowerCase()) return translated;
  const sourceFirst = sourceTrimmed[0];
  const sourceSecond = sourceTrimmed[1] || '';
  if (sourceFirst.toLowerCase() !== first.toLowerCase()) return translated;
  if (sourceSecond && sourceSecond.toLowerCase() === sourceFirst.toLowerCase()) return translated;
  const prefixLength = translated.length - translated.trimStart().length;
  const prefix = translated.slice(0, prefixLength);
  return `${prefix}${targetTrimmed.slice(1)}`;
};

export const formatRowRanges = (indices: number[], limit: number = 3) => {
  if (!indices.length) return '';
  const sorted = [...indices].sort((a, b) => a - b);
  const segments: Array<[number, number]> = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    segments.push([start, prev]);
    start = current;
    prev = current;
  }
  segments.push([start, prev]);

  const displayed = segments.slice(0, limit).map(([s, e]) => {
    if (s === e) return `${s + 1}`;
    return `${s + 1}-${e + 1}`;
  });
  return displayed.join(', ') + (segments.length > limit ? '...' : '');
};

export const cellNeedsTranslation = (
  key: string,
  value: unknown,
  targetLang: TargetLanguage
) => {
  return shouldTranslateCellValue(key, value, targetLang, { shouldLockCell });
};

export const rowNeedsTranslation = (row: POCTRecord, targetLang: TargetLanguage) => {
  return Object.entries(row).some(([key, value]) => cellNeedsTranslation(key, value, targetLang));
};

export const valueNeedsTranslation = (value: unknown, target: TargetLanguage) => {
  return shouldTranslateCellValue('', value, target, { ignoreLock: true });
};

export const LOCKED_KEY_REGEX = /(uuid|(^|[_\s-])id$|编号|序号|唯一标识)/i;

export const shouldLockCell = (key: string, value: unknown) => {
  if (typeof value !== 'string') return false;
  if (!value.trim()) return false;
  if (SOURCE_LANG_REGEX.test(value)) return false;
  if (LOCKED_KEY_REGEX.test(key)) return true;
  return isLikelyIdentifier(value);
};

export const applyPostprocessRow = (
  original: POCTRecord | undefined,
  translated: POCTRecord,
  lang: TargetLanguage
) => {
  const output: POCTRecord = { ...translated };
  Object.entries(translated).forEach(([key, value]) => {
    if (typeof value !== 'string') return;
    const originalValue = original?.[key];
    const lockValue =
      typeof originalValue === 'string' ? originalValue : value;
    if (shouldLockCell(key, lockValue)) return;
    const sourceText = typeof originalValue === 'string' ? originalValue : '';
    output[key] = polishTranslation(sourceText, value, lang);
  });
  return normalizeTerminology(output, lang, original);
};

export const createInitialStages = (): WorkflowStageState[] => ([
  { key: 'ingest', label: '导入文档', status: 'pending' },
  { key: 'translate', label: '全局翻译', status: 'pending' }
]);
