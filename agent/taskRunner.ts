import "./nodeRuntime";

import { promises as fs } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import type { POCTRecord, TargetLanguage } from "../types";
import {
  buildStylePreservingExcelBuffer,
  parseExcelWorkbook
} from "../utils/excel";
import {
  buildDocxFileBytes,
  getDocxSegmentText,
  hasDocxCrossRunWordBreak,
  parseDocxFile,
  setDocxSegmentText
} from "../utils/docx";
import {
  extractStructuredStringContent,
  guardMarkupTags,
  guardStringResourceTokens,
  isLikelyDateFormatPattern,
  isXmlCommentLine,
  localizeDateFormatPattern,
  parseStringResourceLine,
  restoreMarkupTags,
  restoreStringResourceTokens,
  validateStringResourceXml
} from "../utils/stringResources";
import { guardTranslationTokens, restoreTranslationTokens } from "../utils/translationTokens";
import { shouldTranslateCellValue } from "../utils/retryTargets";
import { polishTranslation } from "../utils/postprocess";
import { normalizeTerminology } from "../utils/terminology";
import { rowsToQualityUnits, segmentsToQualityUnits } from "../quality/adapters";
import { runQualityChecksOnUnits } from "../quality/checks";
import type { QualityCheckInput, QualityReport } from "../quality/types";
import { TARGET_LANGUAGE_OPTIONS } from "../utils/targetLanguage";
import type { TranslationProfile } from "../utils/translationProfiles";
import type {
  AgentDocumentKind,
  AgentFailureSummary,
  AgentFileResult,
  AgentIssueCounts,
  AgentStructureCheck,
  AgentTaskDependencies,
  AgentTaskOptions,
  AgentTaskResult,
  AgentTaskStatus,
  AgentTranslateRequest,
  AgentTranslateResponse,
  AgentTranslationProvider
} from "./types";

const SUPPORTED_STRING_EXTENSIONS = new Set([
  ".json",
  ".xml",
  ".properties",
  ".strings"
]);
const KNOWN_BLOCKED_EXTENSIONS = new Set([
  ".xls",
  ".po",
  ".ts",
  ".tsx",
  ".js",
  ".jsx"
]);
const LOCKED_KEY_REGEX = /(uuid|(^|[_\s-])id$|编号|序号|唯一标识)/i;
const EMPTY_COUNTS: AgentIssueCounts = { critical: 0, medium: 0, minor: 0 };

type QualityPayload = {
  sourcePath: string;
  targetLanguage: TargetLanguage;
  model: string;
  quality: QualityReport | null;
  checks: AgentStructureCheck[];
  issueCounts: AgentIssueCounts;
  failures: AgentFailureSummary[];
  notes: string[];
};

const cloneCounts = (): AgentIssueCounts => ({ ...EMPTY_COUNTS });

const addCounts = (left: AgentIssueCounts, right: AgentIssueCounts): AgentIssueCounts => ({
  critical: left.critical + right.critical,
  medium: left.medium + right.medium,
  minor: left.minor + right.minor
});

const safeErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const slugify = (value: string) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "target";

const getKind = (filePath: string): AgentDocumentKind => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".xlsx") return "excel";
  if (extension === ".docx") return "docx";
  if (extension === ".pdf") return "pdf";
  if (SUPPORTED_STRING_EXTENSIONS.has(extension)) return "string-resource";
  return "unsupported";
};

const isKnownTaskFile = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();
  return getKind(filePath) !== "unsupported" || KNOWN_BLOCKED_EXTENSIONS.has(extension);
};

const ensureInside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const assertTaskOptions = async (options: AgentTaskOptions) => {
  if (!options.taskId.trim()) throw new Error("task-id 不能为空。");
  if (!/^[A-Za-z0-9._-]+$/.test(options.taskId)) {
    throw new Error("task-id 只能包含字母、数字、点、下划线和连字符。");
  }
  if (!options.targets.length) throw new Error("至少需要一个目标语言。");
  const invalidTargets = options.targets.filter(
    (target) => !TARGET_LANGUAGE_OPTIONS.includes(target)
  );
  if (invalidTargets.length) {
    throw new Error(`不支持的目标语言：${invalidTargets.join(", ")}`);
  }

  const inputStat = await fs.stat(options.inputPath).catch(() => null);
  if (!inputStat) throw new Error(`输入路径不存在：${options.inputPath}`);
  if (!inputStat.isFile() && !inputStat.isDirectory()) {
    throw new Error("输入路径必须是普通文件或文件夹。");
  }

  if (
    inputStat.isFile() &&
    (path.resolve(options.inputPath) === path.resolve(options.outputDir) ||
      path.resolve(options.inputPath) === path.resolve(options.reportDir))
  ) {
    throw new Error("输出目录或报告目录不能覆盖输入文件。");
  }
  if (
    inputStat.isDirectory() &&
    (path.resolve(options.inputPath) === path.resolve(options.outputDir) ||
      path.resolve(options.inputPath) === path.resolve(options.reportDir))
  ) {
    throw new Error("输出目录或报告目录不能与输入目录相同。");
  }
};

const collectFiles = async (
  inputPath: string,
  excludedRoots: string[]
): Promise<{ files: string[]; inputRoot: string }> => {
  const stat = await fs.stat(inputPath);
  if (stat.isFile()) {
    return { files: [inputPath], inputRoot: path.dirname(inputPath) };
  }

  const files: string[] = [];
  const visit = async (directory: string) => {
    if (excludedRoots.some((root) => ensureInside(root, directory))) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (excludedRoots.some((root) => ensureInside(root, entryPath))) continue;
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && isKnownTaskFile(entryPath)) {
        files.push(entryPath);
      }
    }
  };
  await visit(inputPath);
  files.sort((a, b) => a.localeCompare(b));
  return { files, inputRoot: inputPath };
};

const getOutputPath = (
  outputDir: string,
  inputRoot: string,
  inputFile: string,
  target: TargetLanguage
) => {
  const relative = path.relative(inputRoot, inputFile);
  const safeRelative =
    !relative || relative.startsWith("..") || path.isAbsolute(relative)
      ? path.basename(inputFile)
      : relative;
  const extension = path.extname(safeRelative);
  const stem = safeRelative.slice(0, Math.max(0, safeRelative.length - extension.length));
  return path.join(outputDir, `${stem}.${slugify(target)}.translated${extension}`);
};

const getFileReportPath = (
  reportDir: string,
  taskId: string,
  relativePath: string,
  target: TargetLanguage
) => {
  const safeFile = relativePath.replace(/[^A-Za-z0-9._-]+/g, "-");
  return path.join(reportDir, "files", `${taskId}-${safeFile}-${slugify(target)}.quality.json`);
};

const writeJson = async (filePath: string, value: unknown) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const writeBytesAtomically = async (filePath: string, bytes: Uint8Array) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, bytes);
  await fs.rename(tempPath, filePath);
};

const qualityCounts = (quality: QualityReport | null): AgentIssueCounts => {
  if (!quality) return cloneCounts();
  const { totals } = quality;
  return {
    critical:
      totals.chineseCells +
      totals.placeholderCells +
      totals.idMismatches +
      totals.emptyTranslations +
      totals.structureMismatches +
      totals.nonTargetCells +
      totals.spacingHigh,
    medium: totals.spacingMedium,
    minor: totals.spacingLow
  };
};

const countsWithChecks = (
  quality: QualityReport | null,
  checks: AgentStructureCheck[]
): AgentIssueCounts =>
  checks
    .filter((check) => !check.passed)
    .reduce((counts, check) => {
      counts[check.severity] += 1;
      return counts;
    }, qualityCounts(quality));

const buildFailureSummary = (
  quality: QualityReport | null,
  checks: AgentStructureCheck[]
): AgentFailureSummary[] => {
  const failures: AgentFailureSummary[] = [];
  const appendQualityIssues = (
    issues: QualityReport["issues"][keyof QualityReport["issues"]],
    severity: keyof AgentIssueCounts
  ) => {
    issues.forEach((issue) => {
      failures.push({
        source: "quality",
        type: issue.type,
        severity,
        rowIndex: issue.rowIndex,
        columnKey: issue.columnKey,
        locationLabel: issue.locationLabel,
        value: issue.value,
        original: issue.original
      });
    });
  };

  if (quality) {
    appendQualityIssues(quality.issues.chinese, "critical");
    appendQualityIssues(quality.issues.placeholders, "critical");
    appendQualityIssues(quality.issues.idMismatch, "critical");
    appendQualityIssues(quality.issues.emptyTranslations, "critical");
    appendQualityIssues(quality.issues.structureMismatches, "critical");
    appendQualityIssues(quality.issues.nonTargetLanguage, "critical");
    quality.issues.spacing.forEach((issue) =>
      appendQualityIssues([issue], issue.severity === "high" ? "critical" : issue.severity === "low" ? "minor" : "medium")
    );
  }

  checks
    .filter((check) => !check.passed)
    .forEach((check) => {
      failures.push({
        source: "check",
        type: "check",
        severity: check.severity,
        checkName: check.name,
        detail: check.detail
      });
    });
  return failures;
};

const statusFromCounts = (counts: AgentIssueCounts): AgentTaskStatus => {
  if (counts.critical > 0) return "BLOCKED";
  if (counts.medium > 0 || counts.minor > 0) return "COMPLETED_WITH_WARNINGS";
  return "COMPLETED";
};

const buildQualityPayload = (
  sourcePath: string,
  targetLanguage: TargetLanguage,
  model: string,
  quality: QualityReport | null,
  checks: AgentStructureCheck[],
  notes: string[] = []
): QualityPayload => ({
  sourcePath,
  targetLanguage,
  model,
  quality,
  checks,
  issueCounts: countsWithChecks(quality, checks),
  failures: buildFailureSummary(quality, checks),
  notes
});

const getCredentialBlockReason = (model: string) => {
  const normalized = model.trim().toLowerCase();
  const hasDeepSeek = Boolean(
    process.env.VITE_DEEPSEEK_API_KEY ||
      process.env.Deepseek_API_KEY ||
      process.env.DEEPSEEK_API_KEY
  );
  const hasGemini = Boolean(process.env.GEMINI_API_KEY || process.env.API_KEY);
  const hasOpenRouter = Boolean(
    process.env.OPENROUTER_API_KEY ||
      process.env.VITE_OPENROUTER_API_KEY ||
      process.env.Openrouter_API_KEY
  );

  if (normalized === "auto") {
    return hasDeepSeek || hasGemini || hasOpenRouter
      ? null
      : "本地 direct 模式未配置 DeepSeek、Gemini 或 OpenRouter API Key。";
  }
  if (normalized.startsWith("deepseek-")) {
    return hasDeepSeek ? null : "缺少本地 DeepSeek API Key。";
  }
  if (normalized.startsWith("gemini-")) {
    return hasGemini ? null : "缺少本地 Gemini API Key（GEMINI_API_KEY 或 API_KEY）。";
  }
  if (normalized.startsWith("openrouter:")) {
    return hasOpenRouter ? null : "缺少本地 OPENROUTER_API_KEY。";
  }
  return `本地 Agent 暂不识别模型标识“${model}”；可使用 auto、deepseek-*、gemini-* 或 openrouter:<model-id>。`;
};

class RepositoryTranslationProvider implements AgentTranslationProvider {
  private hubPromise:
    | Promise<InstanceType<typeof import("../services/translationHub").TranslationHub>>
    | null = null;

  private async getHub() {
    if (!this.hubPromise) {
      process.env.VITE_TRANSLATION_MODE = "direct";
      this.hubPromise = import("../services/translationHub").then(
        ({ TranslationHub }) => new TranslationHub()
      );
    }
    return this.hubPromise;
  }

  async translate(request: AgentTranslateRequest): Promise<AgentTranslateResponse> {
    const hub = await this.getHub();
    const normalized = request.model.trim().toLowerCase();
    const options: {
      model?: "deepseek" | "gemini" | "openrouter";
      providerModel?: string;
      openRouterModel?: string;
      profile: TranslationProfile;
    } = { profile: request.profile };

    if (normalized.startsWith("deepseek-")) {
      options.model = "deepseek";
      options.providerModel = request.model;
    } else if (normalized.startsWith("gemini-")) {
      options.model = "gemini";
    } else if (normalized.startsWith("openrouter:")) {
      options.model = "openrouter";
      options.openRouterModel = request.model.slice("openrouter:".length);
    }

    const records = await hub.translateBatch({
      records: request.records,
      targetLang: request.targetLanguage,
      options
    });
    return { records, engine: hub.getLastEngine() };
  }
}

const finalizeValue = (
  source: string,
  candidate: unknown,
  targetLanguage: TargetLanguage,
  placeholders?: Record<string, string> | null
) => {
  const raw = typeof candidate === "string" ? candidate : source;
  const restored = restoreTranslationTokens(raw, placeholders);
  const polished = polishTranslation(source, restored, targetLanguage);
  const normalized = normalizeTerminology(
    { content: polished },
    targetLanguage,
    { content: source }
  );
  return typeof normalized.content === "string" ? normalized.content : polished;
};

const translateTextItems = async <T extends string | number>(
  items: Array<{ index: T; text: string }>,
  targetLanguage: TargetLanguage,
  model: string,
  profile: TranslationProfile,
  provider: AgentTranslationProvider
) => {
  const output = new Map<T, string>();
  const batchSize = /deepseek-v4-pro/i.test(model) ? 8 : 20;
  let engine = "not-required";

  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    const guards = batch.map((item) => guardTranslationTokens(item.text));
    const response = await provider.translate({
      records: guards.map((guard) => ({ content: guard.sanitized })),
      targetLanguage,
      model,
      profile
    });
    engine = response.engine;
    if (response.records.length !== batch.length) {
      throw new Error(
        `模型返回 ${response.records.length} 条，预期 ${batch.length} 条。`
      );
    }
    response.records.forEach((record, offset) => {
      const item = batch[offset];
      output.set(
        item.index,
        finalizeValue(
          item.text,
          record.content,
          targetLanguage,
          guards[offset].placeholders
        )
      );
    });
  }
  return { values: output, engine };
};

const processExcel = async (
  inputPath: string,
  outputPath: string,
  targetLanguage: TargetLanguage,
  model: string,
  provider: AgentTranslationProvider
) => {
  const sourceBytes = await fs.readFile(inputPath);
  const workbook = XLSX.read(sourceBytes, {
    type: "buffer",
    cellStyles: true,
    cellFormula: true
  });
  const parsed = parseExcelWorkbook(workbook);
  parsed.context.sourceArrayBuffer = sourceBytes.buffer.slice(
    sourceBytes.byteOffset,
    sourceBytes.byteOffset + sourceBytes.byteLength
  ) as ArrayBuffer;
  const translatedRows = parsed.records.map((row) => ({ ...row }));
  const batchSize = /deepseek-v4-pro/i.test(model) ? 5 : 10;
  let engine = "unknown";

  for (let start = 0; start < parsed.records.length; start += batchSize) {
    const sourceBatch = parsed.records.slice(start, start + batchSize);
    const placeholders = new Map<string, Record<string, string> | null>();
    const payload = sourceBatch.map((row, offset) => {
      const sanitized: POCTRecord = {};
      Object.entries(row).forEach(([key, value]) => {
        const locked = LOCKED_KEY_REGEX.test(key);
        if (
          !locked &&
          shouldTranslateCellValue(key, value, targetLanguage, {
            requireTargetLanguageEvidence: true,
            shouldLockCell: (cellKey) => LOCKED_KEY_REGEX.test(cellKey)
          })
        ) {
          const guard = guardTranslationTokens(String(value));
          sanitized[key] = guard.sanitized;
          placeholders.set(`${offset}:${key}`, guard.placeholders);
        }
      });
      return sanitized;
    });
    if (!payload.some((row) => Object.keys(row).length > 0)) continue;

    const response = await provider.translate({
      records: payload,
      targetLanguage,
      model,
      profile: "spreadsheet"
    });
    engine = response.engine;
    if (response.records.length !== payload.length) {
      throw new Error(
        `模型返回 ${response.records.length} 行，预期 ${payload.length} 行。`
      );
    }
    response.records.forEach((translated, offset) => {
      Object.keys(payload[offset]).forEach((key) => {
        const sourceValue = String(sourceBatch[offset][key]);
        translatedRows[start + offset][key] = finalizeValue(
          sourceValue,
          translated[key],
          targetLanguage,
          placeholders.get(`${offset}:${key}`)
        );
      });
    });
  }

  const { bytes, stats } = await buildStylePreservingExcelBuffer(
    translatedRows,
    parsed.context
  );
  await writeBytesAtomically(outputPath, bytes);

  const reopened = XLSX.read(await fs.readFile(outputPath), {
    type: "buffer",
    cellStyles: true,
    cellFormula: true
  });
  const reopenedParsed = parseExcelWorkbook(reopened);
  const sourceSheetNames = workbook.SheetNames;
  const targetSheetNames = reopened.SheetNames;
  const checks: AgentStructureCheck[] = [
    {
      name: "output-openable",
      passed: true,
      severity: "critical",
      detail: "输出文件可被 XLSX 解析器重新打开。"
    },
    {
      name: "sheet-order",
      passed: JSON.stringify(sourceSheetNames) === JSON.stringify(targetSheetNames),
      severity: "critical",
      detail: `源工作表 ${sourceSheetNames.length} 个，输出工作表 ${targetSheetNames.length} 个。`
    },
    {
      name: "row-column-relation",
      passed:
        parsed.records.length === reopenedParsed.records.length &&
        parsed.context.sheets.every((sheet, index) => {
          const targetSheet = reopenedParsed.context.sheets[index];
          return (
            targetSheet &&
            sheet.rowCount === targetSheet.rowCount &&
            JSON.stringify(sheet.headerKeys) === JSON.stringify(targetSheet.headerKeys)
          );
        }),
      severity: "critical",
      detail: `源数据行 ${parsed.records.length}，输出数据行 ${reopenedParsed.records.length}。`
    },
    {
      name: "formula-preservation",
      passed: stats.overwrittenFormulas === 0,
      severity: "critical",
      detail: `覆盖公式 ${stats.overwrittenFormulas} 个，跳过公式 ${stats.skippedFormulas} 个。`
    }
  ];
  const quality = runQualityChecksOnUnits(
    rowsToQualityUnits(parsed.records, reopenedParsed.records, "excel"),
    { targetLang: targetLanguage }
  );
  return { engine, quality, checks };
};

const processDocx = async (
  inputPath: string,
  outputPath: string,
  targetLanguage: TargetLanguage,
  model: string,
  provider: AgentTranslationProvider
) => {
  const sourceBytes = await fs.readFile(inputPath);
  const file = new File([sourceBytes], path.basename(inputPath), {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
  const context = await parseDocxFile(file);
  const sourceSegments = context.segments.map((segment) => ({
    coordinate: segment.coordinate,
    original: segment.original,
    runTexts: segment.nodes.map((node) => node.textContent || ""),
    partPath: segment.partPath,
    partLabel: segment.partLabel
  }));
  const sourceSegmentsByCoordinate = new Map(
    context.segments.map((segment) => [segment.coordinate, segment])
  );
  const items = context.segments
    .map((segment) => ({ index: segment.coordinate, text: segment.original }))
    .filter((item) =>
      shouldTranslateCellValue("content", item.text, targetLanguage, {
        ignoreLock: true,
        requireTargetLanguageEvidence: true
      })
    );
  const translated = await translateTextItems(
    items,
    targetLanguage,
    model,
    "docx-manual",
    provider
  );
  translated.values.forEach((text, coordinate) => {
    const segment = sourceSegmentsByCoordinate.get(coordinate);
    if (!segment) {
      throw new Error(`DOCX 回填坐标不存在：${coordinate}`);
    }
    setDocxSegmentText(segment, text);
  });
  const outputBytes = await buildDocxFileBytes(context, targetLanguage);
  await writeBytesAtomically(outputPath, outputBytes);

  const reopenedFile = new File([await fs.readFile(outputPath)], path.basename(outputPath), {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
  const reopened = await parseDocxFile(reopenedFile);
  const reopenedSegmentsByCoordinate = new Map(
    reopened.segments.map((segment) => [segment.coordinate, segment])
  );
  const sourcePartPaths = context.coverage.parts.map((part) => part.path);
  const targetPartPaths = reopened.coverage.parts.map((part) => part.path);
  const sourceCoordinates = sourceSegments.map((segment) => segment.coordinate);
  const targetCoordinates = reopened.segments.map((segment) => segment.coordinate);
  const checks: AgentStructureCheck[] = [
    {
      name: "output-openable",
      passed: true,
      severity: "critical",
      detail: "输出 DOCX 可重新解包并解析。"
    },
    {
      name: "xml-part-coverage",
      passed: JSON.stringify(sourcePartPaths) === JSON.stringify(targetPartPaths),
      severity: "critical",
      detail: `源 XML 部件 ${sourcePartPaths.length} 个，输出 ${targetPartPaths.length} 个。`
    },
    {
      name: "segment-coverage",
      passed: sourceSegments.length === reopened.segments.length,
      severity: "critical",
      detail: `源语义段 ${sourceSegments.length} 个，输出 ${reopened.segments.length} 个。`
    },
    {
      name: "segment-coordinate-alignment",
      passed: JSON.stringify(sourceCoordinates) === JSON.stringify(targetCoordinates),
      severity: "critical",
      detail: `逐坐标比对源段 ${sourceCoordinates.length} 个，输出段 ${targetCoordinates.length} 个。`
    },
    ...context.coverageWarnings.map((warning) => ({
      name: "coverage-warning",
      passed: false,
      severity: "medium" as const,
      detail: warning
    }))
  ];
  const qualityInput: QualityCheckInput = segmentsToQualityUnits(
    sourceSegments,
    "docx",
    (segment) => {
      const reopenedSegment = reopenedSegmentsByCoordinate.get(segment.coordinate);
      return reopenedSegment ? getDocxSegmentText(reopenedSegment) : "";
    },
    (segment) => segment.original,
    (segment) => `${segment.partLabel}:${segment.coordinate}`,
    (segment) => {
      const reopenedSegment = reopenedSegmentsByCoordinate.get(segment.coordinate);
      return Boolean(
        reopenedSegment &&
          hasDocxCrossRunWordBreak(segment.runTexts, reopenedSegment)
      );
    }
  );
  const quality = runQualityChecksOnUnits(qualityInput, { targetLang: targetLanguage });
  return {
    engine: translated.engine,
    quality,
    checks
  };
};

const translateLineStringResource = async (
  input: string,
  extension: string,
  targetLanguage: TargetLanguage,
  model: string,
  provider: AgentTranslationProvider
) => {
  const lineBreak = input.includes("\r\n") ? "\r\n" : "\n";
  const hasTrailingNewline = input.endsWith("\n");
  const lines = input.split(/\r?\n/);
  const parseLine = (line: string) => {
    if (extension === ".properties") {
      if (/^\s*[#!]/.test(line)) {
        return {
          original: line,
          prefix: "",
          content: line,
          suffix: "",
          needsTranslation: false
        };
      }
      const match = line.match(/^(\s*[^:=\s][^:=]*?\s*[:=]\s*)([\s\S]*)$/);
      if (match) {
        return {
          original: line,
          prefix: match[1],
          content: match[2],
          suffix: "",
          needsTranslation: /[\u4e00-\u9fff]/.test(match[2])
        };
      }
    }
    if (extension === ".strings") {
      if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) {
        return {
          original: line,
          prefix: "",
          content: line,
          suffix: "",
          needsTranslation: false
        };
      }
      const match = line.match(/^(\s*"[^"]+"\s*=\s*")([\s\S]*?)("\s*;\s*)$/);
      if (match) {
        return {
          original: line,
          prefix: match[1],
          content: match[2],
          suffix: match[3],
          needsTranslation: /[\u4e00-\u9fff]/.test(match[2])
        };
      }
    }
    return parseStringResourceLine(line);
  };
  const entries = lines.map(parseLine);
  const translatedEntryIndices = new Set(
    entries
      .map((entry, index) => {
        if (isXmlCommentLine(lines[index] || "") || entry.explicitlyNonTranslatable) {
          return -1;
        }
        const structured = extractStructuredStringContent(entry.content);
        return shouldTranslateCellValue(
          "content",
          structured.translatableContent,
          targetLanguage,
          {
            ignoreLock: true,
            requireTargetLanguageEvidence: true
          }
        )
          ? index
          : -1;
      })
      .filter((index) => index >= 0)
  );
  const payload: POCTRecord[] = [];
  const indexMap = new Map<number, number>();
  const tokenStore = new Map<number, Record<string, string> | null>();
  const markupStore = new Map<number, Record<string, string> | null>();

  entries.forEach((entry, index) => {
    if (!translatedEntryIndices.has(index)) return;
    const structured = extractStructuredStringContent(entry.content);
    if (isLikelyDateFormatPattern(structured.translatableContent)) return;
    const markup = guardMarkupTags(structured.translatableContent);
    const guarded = guardStringResourceTokens(markup.sanitized);
    indexMap.set(index, payload.length);
    tokenStore.set(index, guarded.placeholders);
    markupStore.set(index, markup.placeholders);
    payload.push({ content: guarded.sanitized });
  });

  const translated: POCTRecord[] = [];
  let engine = "not-required";
  for (let start = 0; start < payload.length; start += 40) {
    const response = await provider.translate({
      records: payload.slice(start, start + 40),
      targetLanguage,
      model,
      profile: "spreadsheet"
    });
    engine = response.engine;
    translated.push(...response.records);
  }
  if (translated.length !== payload.length) {
    throw new Error(`模型返回 ${translated.length} 条，预期 ${payload.length} 条。`);
  }

  const outputLines = entries.map((entry, index) => {
    if (!translatedEntryIndices.has(index)) {
      return entry.original;
    }
    const structured = extractStructuredStringContent(entry.content);
    if (isLikelyDateFormatPattern(structured.translatableContent)) {
      return `${entry.prefix}${structured.outerPrefix}${localizeDateFormatPattern(
        structured.translatableContent,
        targetLanguage
      )}${structured.outerSuffix}${entry.suffix}`;
    }
    const payloadIndex = indexMap.get(index);
    const candidate =
      payloadIndex === undefined
        ? structured.translatableContent
        : translated[payloadIndex]?.content;
    const restored = restoreStringResourceTokens(
      typeof candidate === "string" ? candidate : structured.translatableContent,
      tokenStore.get(index)
    );
    const restoredMarkup = restoreMarkupTags(restored, markupStore.get(index));
    const polished = polishTranslation(
      structured.translatableContent,
      restoredMarkup,
      targetLanguage
    );
    const normalized = normalizeTerminology(
      { content: polished },
      targetLanguage,
      { content: structured.translatableContent }
    );
    return `${entry.prefix}${structured.outerPrefix}${
      typeof normalized.content === "string" ? normalized.content : polished
    }${structured.outerSuffix}${entry.suffix}`;
  });
  return {
    output: outputLines.join(lineBreak) + (hasTrailingNewline ? lineBreak : ""),
    engine,
    entries,
    outputEntries: outputLines.map(parseLine)
  };
};

type JsonLeaf = { path: Array<string | number>; source: string };

const collectJsonLeaves = (
  value: unknown,
  currentPath: Array<string | number> = [],
  output: JsonLeaf[] = []
) => {
  if (typeof value === "string") {
    output.push({ path: currentPath, source: value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectJsonLeaves(item, [...currentPath, index], output));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) =>
      collectJsonLeaves(item, [...currentPath, key], output)
    );
  }
  return output;
};

const setJsonPath = (root: unknown, jsonPath: Array<string | number>, value: string) => {
  let cursor = root as Record<string | number, unknown>;
  jsonPath.slice(0, -1).forEach((part) => {
    cursor = cursor[part] as Record<string | number, unknown>;
  });
  cursor[jsonPath[jsonPath.length - 1]] = value;
};

const jsonShape = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(jsonShape);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonShape(item)])
    );
  }
  return typeof value;
};

const processStringResource = async (
  inputPath: string,
  outputPath: string,
  targetLanguage: TargetLanguage,
  model: string,
  provider: AgentTranslationProvider
) => {
  const input = await fs.readFile(inputPath, "utf8");
  const extension = path.extname(inputPath).toLowerCase();
  let output: string;
  let engine = "not-required";
  let qualityInput: QualityCheckInput;
  const checks: AgentStructureCheck[] = [];

  if (extension === ".json") {
    const sourceJson = JSON.parse(input);
    const targetJson = JSON.parse(JSON.stringify(sourceJson));
    const leaves = collectJsonLeaves(sourceJson);
    const translatable = leaves
      .map((leaf, index) => ({ index, text: leaf.source }))
      .filter((item) =>
        shouldTranslateCellValue("content", item.text, targetLanguage, {
          ignoreLock: true,
          requireTargetLanguageEvidence: true
        })
      );
    const translated = await translateTextItems(
      translatable,
      targetLanguage,
      model,
      "spreadsheet",
      provider
    );
    translated.values.forEach((text, index) =>
      setJsonPath(targetJson, leaves[index].path, text)
    );
    output = `${JSON.stringify(targetJson, null, 2)}\n`;
    const reopened = JSON.parse(output);
    const targetLeaves = collectJsonLeaves(reopened);
    qualityInput = rowsToQualityUnits(
      leaves.map((leaf) => ({ content: leaf.source })),
      targetLeaves.map((leaf) => ({ content: leaf.source })),
      "string-resource"
    );
    checks.push(
      {
        name: "output-openable",
        passed: true,
        severity: "critical",
        detail: "输出可被 JSON.parse 重新解析。"
      },
      {
        name: "json-structure",
        passed: JSON.stringify(jsonShape(sourceJson)) === JSON.stringify(jsonShape(reopened)),
        severity: "critical",
        detail: "JSON 键、数组位置和值类型结构保持一致。"
      }
    );
    engine = translated.engine;
  } else {
    const translated = await translateLineStringResource(
      input,
      extension,
      targetLanguage,
      model,
      provider
    );
    output = translated.output;
    engine = translated.engine;
    qualityInput = rowsToQualityUnits(
      translated.entries.map((entry) => ({ content: entry.content })),
      translated.outputEntries.map((entry) => ({ content: entry.content })),
      "string-resource"
    );
    checks.push({
      name: "line-structure",
      passed:
        translated.entries.length === translated.outputEntries.length &&
        translated.entries.every(
          (entry, index) =>
            entry.prefix === translated.outputEntries[index]?.prefix &&
            entry.suffix === translated.outputEntries[index]?.suffix
        ),
      severity: "critical",
      detail: `源行 ${translated.entries.length}，输出行 ${translated.outputEntries.length}。`
    });
    if (extension === ".xml") {
      const validation = validateStringResourceXml(output);
      checks.push({
        name: "output-openable",
        passed: validation.valid,
        severity: "critical",
        detail: validation.valid ? "输出 XML 可解析。" : validation.error || "XML 无效。"
      });
    } else {
      checks.push({
        name: "output-openable",
        passed: Buffer.from(output, "utf8").toString("utf8") === output,
        severity: "critical",
        detail: "输出可按 UTF-8 重新读取。"
      });
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, output, "utf8");
  await fs.rename(tempPath, outputPath);
  const reopenedText = await fs.readFile(outputPath, "utf8");
  checks.push({
    name: "written-output-readable",
    passed: reopenedText === output,
    severity: "critical",
    detail: "落盘内容与生成内容一致。"
  });
  return {
    engine,
    quality: runQualityChecksOnUnits(qualityInput, { targetLang: targetLanguage }),
    checks
  };
};

const blockedResult = async (
  inputPath: string,
  relativePath: string,
  kind: AgentDocumentKind,
  targetLanguage: TargetLanguage,
  model: string,
  qualityReportPath: string,
  message: string
): Promise<AgentFileResult> => {
  const checks: AgentStructureCheck[] = [
    {
      name: "capability",
      passed: false,
      severity: "critical",
      detail: message
    }
  ];
  const payload = buildQualityPayload(
    inputPath,
    targetLanguage,
    model,
    null,
    checks,
    [message]
  );
  await writeJson(qualityReportPath, payload);
  return {
    inputPath,
    relativePath,
    kind,
    targetLanguage,
    model,
    engine: null,
    status: "BLOCKED",
    outputPath: null,
    qualityReportPath,
    issueCounts: payload.issueCounts,
    checks,
    failures: payload.failures,
    message
  };
};

const runFileTarget = async ({
  inputPath,
  relativePath,
  inputRoot,
  options,
  targetLanguage,
  provider,
  useInjectedProvider
}: {
  inputPath: string;
  relativePath: string;
  inputRoot: string;
  options: AgentTaskOptions;
  targetLanguage: TargetLanguage;
  provider: AgentTranslationProvider;
  useInjectedProvider: boolean;
}): Promise<AgentFileResult> => {
  const kind = getKind(inputPath);
  const reportPath = getFileReportPath(
    options.reportDir,
    options.taskId,
    relativePath,
    targetLanguage
  );
  if (kind === "pdf") {
    return blockedResult(
      inputPath,
      relativePath,
      kind,
      targetLanguage,
      options.model,
      reportPath,
      "PDF 当前解析和写回依赖浏览器 Canvas/字体环境；本地 Node Agent 尚无可验证适配器，未调用模型。"
    );
  }
  if (kind === "unsupported") {
    return blockedResult(
      inputPath,
      relativePath,
      kind,
      targetLanguage,
      options.model,
      reportPath,
      `文件扩展名 ${path.extname(inputPath) || "(无)"} 尚无可验证的本地适配器。`
    );
  }
  if (!useInjectedProvider) {
    const reason = getCredentialBlockReason(options.model);
    if (reason) {
      return blockedResult(
        inputPath,
        relativePath,
        kind,
        targetLanguage,
        options.model,
        reportPath,
        reason
      );
    }
  }

  const outputPath = getOutputPath(
    options.outputDir,
    inputRoot,
    inputPath,
    targetLanguage
  );
  if (path.resolve(outputPath) === path.resolve(inputPath)) {
    return blockedResult(
      inputPath,
      relativePath,
      kind,
      targetLanguage,
      options.model,
      reportPath,
      "计算出的输出路径与输入文件相同，已阻止覆盖。"
    );
  }

  try {
    const execution =
      kind === "excel"
        ? await processExcel(
            inputPath,
            outputPath,
            targetLanguage,
            options.model,
            provider
          )
        : kind === "docx"
          ? await processDocx(
              inputPath,
              outputPath,
              targetLanguage,
              options.model,
              provider
            )
          : await processStringResource(
              inputPath,
              outputPath,
              targetLanguage,
              options.model,
              provider
            );
    const payload = buildQualityPayload(
      inputPath,
      targetLanguage,
      options.model,
      execution.quality,
      execution.checks
    );
    await writeJson(reportPath, payload);
    const status = statusFromCounts(payload.issueCounts);
    return {
      inputPath,
      relativePath,
      kind,
      targetLanguage,
      model: options.model,
      engine: execution.engine,
      status,
      outputPath,
      qualityReportPath: reportPath,
      issueCounts: payload.issueCounts,
      checks: execution.checks,
      failures: payload.failures,
      message:
        status === "BLOCKED"
          ? "翻译输出已生成，但 QA 发现严重问题，禁止进入人工验收。"
          : "翻译与自动 QA 已完成，等待人工验收；不代表已可交付或配置。"
    };
  } catch (error) {
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
    const message = safeErrorMessage(error);
    const checks: AgentStructureCheck[] = [
      {
        name: "execution",
        passed: false,
        severity: "critical",
        detail: message
      }
    ];
    const payload = buildQualityPayload(
      inputPath,
      targetLanguage,
      options.model,
      null,
      checks,
      [message]
    );
    await writeJson(reportPath, payload);
    return {
      inputPath,
      relativePath,
      kind,
      targetLanguage,
      model: options.model,
      engine: null,
      status: "FAILED",
      outputPath: null,
      qualityReportPath: reportPath,
      issueCounts: payload.issueCounts,
      checks,
      failures: payload.failures,
      message
    };
  }
};

const overallStatus = (files: AgentFileResult[]): AgentTaskStatus => {
  if (files.some((file) => file.status === "FAILED")) return "FAILED";
  if (files.some((file) => file.status === "BLOCKED")) return "BLOCKED";
  if (files.some((file) => file.status === "COMPLETED_WITH_WARNINGS")) {
    return "COMPLETED_WITH_WARNINGS";
  }
  return "COMPLETED";
};

export const runAgentTranslationTask = async (
  rawOptions: AgentTaskOptions,
  dependencies: AgentTaskDependencies = {}
): Promise<AgentTaskResult> => {
  const options: AgentTaskOptions = {
    ...rawOptions,
    inputPath: path.resolve(rawOptions.inputPath),
    outputDir: path.resolve(rawOptions.outputDir),
    reportDir: path.resolve(rawOptions.reportDir),
    targets: Array.from(new Set(rawOptions.targets))
  };
  const now = dependencies.now || (() => new Date());
  const startedAt = now().toISOString();
  await assertTaskOptions(options);
  const excludedRoots = [options.outputDir, options.reportDir];
  const { files, inputRoot } = await collectFiles(options.inputPath, excludedRoots);
  await fs.mkdir(options.outputDir, { recursive: true });
  await fs.mkdir(options.reportDir, { recursive: true });

  const provider = dependencies.translationProvider || new RepositoryTranslationProvider();
  const fileResults: AgentFileResult[] = [];
  if (!files.length) {
    const placeholderPath = path.join(options.reportDir, `${options.taskId}-no-input`);
    fileResults.push(
      await blockedResult(
        options.inputPath,
        ".",
        "unsupported",
        options.targets[0],
        options.model,
        `${placeholderPath}.quality.json`,
        "输入目录中未发现 Excel、DOCX、PDF 或受支持的字符串资源文件。"
      )
    );
  } else {
    for (const inputFile of files) {
      const relativePath = path.relative(inputRoot, inputFile) || path.basename(inputFile);
      for (const targetLanguage of options.targets) {
        fileResults.push(
          await runFileTarget({
            inputPath: inputFile,
            relativePath,
            inputRoot,
            options,
            targetLanguage,
            provider,
            useInjectedProvider: Boolean(dependencies.translationProvider)
          })
        );
      }
    }
  }

  const status = overallStatus(fileResults);
  const issueCounts = fileResults.reduce(
    (counts, file) => addCounts(counts, file.issueCounts),
    cloneCounts()
  );
  const completedAt = now().toISOString();
  const masterReportPath = path.join(
    options.reportDir,
    `${options.taskId}-quality-report.json`
  );
  const logPath = path.join(options.reportDir, `${options.taskId}.log.jsonl`);
  const readyForHumanReview =
    status === "COMPLETED" || status === "COMPLETED_WITH_WARNINGS";
  const result: AgentTaskResult = {
    schema: "poct.agent.translation-task.v1",
    taskId: options.taskId,
    status,
    startedAt,
    completedAt,
    inputPath: options.inputPath,
    inputFiles: files,
    outputDir: options.outputDir,
    reportDir: options.reportDir,
    outputFiles: fileResults
      .map((file) => file.outputPath)
      .filter((file): file is string => Boolean(file)),
    model: options.model,
    targetLanguages: options.targets,
    files: fileResults,
    issueCounts,
    qualityReportPath: masterReportPath,
    logPath,
    readyForHumanReview,
    deliveryStatus: readyForHumanReview ? "AWAITING_HUMAN_ACCEPTANCE" : "BLOCKED",
    message: readyForHumanReview
      ? "本地翻译与自动 QA 已完成，可进入人工验收；尚未声明可交付或可配置。"
      : "任务被阻断或执行失败，不能进入人工验收。"
  };
  await fs.writeFile(
    logPath,
    `${fileResults
      .map((file) =>
        JSON.stringify({
          timestamp: completedAt,
          taskId: options.taskId,
          inputPath: file.inputPath,
          targetLanguage: file.targetLanguage,
          kind: file.kind,
          status: file.status,
          outputPath: file.outputPath,
          qualityReportPath: file.qualityReportPath,
          message: file.message
        })
      )
      .join("\n")}\n`,
    "utf8"
  );
  await writeJson(masterReportPath, result);
  return result;
};
