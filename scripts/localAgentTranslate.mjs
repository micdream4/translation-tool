import fs from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
const repoRoot = path.resolve(import.meta.dirname, "..");
const DEFAULT_INBOX = "local-data/agent/inbox";
const DEFAULT_DONE = "local-data/agent/done";
const DEFAULT_REPORTS = "local-data/agent/reports";
const DEFAULT_TRANSLATION_BATCH_SIZE = 24;
const DEFAULT_TRANSLATION_BATCH_CHARS = 12000;
const DEFAULT_REVIEW_BATCH_SIZE = 20;
const DEFAULT_REVIEW_SAMPLE_SIZE = 80;
const DEFAULT_MAX_REPAIR_ROUNDS = 3;
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([".xlsx", ".xlsm", ".docx", ".pdf"]);
const EXCEL_EXTENSIONS = new Set([".xlsx", ".xlsm"]);
const SOURCE_LANG_REGEX = /[\u4e00-\u9fff]/;
const LOCKED_KEY_REGEX = /(uuid|(^|[_\s-])id$|编号|序号|唯一标识)/i;
const NODE_BUILTIN_EXTERNALS = [
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`)
];

const parseArgs = (argv) => {
  const options = {
    target: "",
    input: DEFAULT_INBOX,
    output: DEFAULT_DONE,
    reports: DEFAULT_REPORTS,
    engine: "deepseek",
    model: "",
    reviewModel: "",
    semantic: "sample",
    reviewSampleSize: DEFAULT_REVIEW_SAMPLE_SIZE,
    reviewBatchSize: DEFAULT_REVIEW_BATCH_SIZE,
    maxRepairRounds: DEFAULT_MAX_REPAIR_ROUNDS,
    batchSize: DEFAULT_TRANSLATION_BATCH_SIZE,
    batchChars: DEFAULT_TRANSLATION_BATCH_CHARS,
    dryRun: false
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return value;
    };

    if (arg === "--target" || arg === "--lang") options.target = readValue();
    else if (arg === "--input" || arg === "--inbox") options.input = readValue();
    else if (arg === "--output" || arg === "--done") options.output = readValue();
    else if (arg === "--reports") options.reports = readValue();
    else if (arg === "--engine") options.engine = readValue();
    else if (arg === "--model" || arg === "--provider-model") options.model = readValue();
    else if (arg === "--review-model") options.reviewModel = readValue();
    else if (arg === "--semantic") options.semantic = readValue();
    else if (arg === "--review-sample-size") options.reviewSampleSize = Number(readValue());
    else if (arg === "--review-batch-size") options.reviewBatchSize = Number(readValue());
    else if (arg === "--max-repair-rounds") options.maxRepairRounds = Number(readValue());
    else if (arg === "--batch-size") options.batchSize = Number(readValue());
    else if (arg === "--batch-chars") options.batchChars = Number(readValue());
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }

  if (!options.target && positional.length > 0) {
    options.target = positional[0];
  }
  options.semantic = String(options.semantic || "sample").toLowerCase();
  if (!["sample", "full"].includes(options.semantic)) {
    throw new Error("--semantic must be sample or full. Semantic review is required for this local agent.");
  }
  options.reviewSampleSize = Math.max(1, Math.floor(options.reviewSampleSize || DEFAULT_REVIEW_SAMPLE_SIZE));
  options.reviewBatchSize = Math.max(1, Math.floor(options.reviewBatchSize || DEFAULT_REVIEW_BATCH_SIZE));
  options.maxRepairRounds = Math.max(0, Math.floor(options.maxRepairRounds ?? DEFAULT_MAX_REPAIR_ROUNDS));
  options.batchSize = Math.max(1, Math.floor(options.batchSize || DEFAULT_TRANSLATION_BATCH_SIZE));
  options.batchChars = Math.max(1000, Math.floor(options.batchChars || DEFAULT_TRANSLATION_BATCH_CHARS));
  return options;
};

const usage = () => `
Usage:
  npm run agent:translate -- --target Portuguese
  npm run agent:translate -- --target French --input local-data/inbox --output local-data/done
  npm run agent:translate -- --target Russian --semantic full --review-model deepseek-v4-pro

Defaults:
  input:   ${DEFAULT_INBOX}
  output:  ${DEFAULT_DONE}
  reports: ${DEFAULT_REPORTS}

Semantic review is required. Use --semantic sample for broad deterministic sampling or --semantic full for final delivery checks.
`;

const resolveRepoPath = (value) => path.resolve(repoRoot, value);

const parseEnvFile = async () => {
  try {
    const raw = await fs.readFile(resolveRepoPath(".env.local"), "utf8");
    return Object.fromEntries(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const [key, ...rest] = line.split("=");
          return [key.trim(), rest.join("=").trim().replace(/^['"]|['"]$/g, "")];
        })
    );
  } catch {
    return {};
  }
};

const loadEnv = async () => {
  const envFile = await parseEnvFile();
  Object.entries(envFile).forEach(([key, value]) => {
    if (process.env[key] === undefined) process.env[key] = value;
  });
  process.env.VITE_TRANSLATION_MODE ||= "direct";
};

const bundleTsModule = async (sourcePath) => {
  const tmpDir = await fs.mkdtemp(path.join(repoRoot, ".tmp-agent-bundle-"));
  const outputPath = path.join(tmpDir, `${path.basename(sourcePath, ".ts")}.cjs`);
  try {
    await esbuild.build({
      entryPoints: [sourcePath],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      outfile: outputPath,
      external: [
        ...NODE_BUILTIN_EXTERNALS,
        "xlsx",
        "jszip",
    "pdfjs-dist",
    "pdf-lib",
        "@pdf-lib/fontkit"
      ],
      logLevel: "silent"
    });
    return require(outputPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
};

const loadCoreModules = async () => {
  const [
    excel,
    translationHub,
    postprocess,
    terminology,
    translationTokens,
    retryTargets,
    quality,
    sampleReview,
    docx,
    batching
  ] = await Promise.all([
    bundleTsModule(resolveRepoPath("utils/excel.ts")),
    bundleTsModule(resolveRepoPath("services/translationHub.ts")),
    bundleTsModule(resolveRepoPath("utils/postprocess.ts")),
    bundleTsModule(resolveRepoPath("utils/terminology.ts")),
    bundleTsModule(resolveRepoPath("utils/translationTokens.ts")),
    bundleTsModule(resolveRepoPath("utils/retryTargets.ts")),
    bundleTsModule(resolveRepoPath("utils/quality.ts")),
    bundleTsModule(resolveRepoPath("services/sampleReviewAuditService.ts")),
    bundleTsModule(resolveRepoPath("utils/docx.ts")),
    bundleTsModule(resolveRepoPath("utils/translationBatching.ts"))
  ]);

  return {
    ...excel,
    ...docx,
    ...postprocess,
    ...terminology,
    ...translationTokens,
    ...retryTargets,
    ...quality,
    ...batching,
    TranslationHub: translationHub.TranslationHub,
    SampleReviewAuditService: sampleReview.SampleReviewAuditService
  };
};

const listDocumentFiles = async (inputDir) => {
  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(inputDir, entry.name))
    .filter((filePath) => SUPPORTED_DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

const toArrayBuffer = (buffer) =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

const readWorkbookWithContext = async (filePath, core) => {
  const bytes = await fs.readFile(filePath);
  const workbook = XLSX.read(bytes, { type: "buffer", cellStyles: true });
  const parsed = core.parseExcelWorkbook(workbook);
  parsed.context.sourceArrayBuffer = toArrayBuffer(bytes);
  return parsed;
};

const getSheetForRow = (context, rowIndex) =>
  (context.sheets || [context]).find(
    (sheet) => rowIndex >= sheet.startIndex && rowIndex < sheet.startIndex + sheet.rowCount
  ) || context;

const getCellLocation = (context, rowIndex, key) => {
  const sheet = getSheetForRow(context, rowIndex);
  const columnOffset = sheet.headerKeys.indexOf(key);
  if (columnOffset < 0) return `${sheet.sheetName}: row ${rowIndex + 1}, ${key}`;
  const sheetRow = sheet.dataStartRow + (rowIndex - sheet.startIndex);
  const address = XLSX.utils.encode_cell({ r: sheetRow, c: sheet.range.s.c + columnOffset });
  return `${sheet.sheetName}!${address}`;
};

const shouldLockCell = (core, key, value) => {
  if (typeof value !== "string") return false;
  if (!value.trim()) return false;
  if (SOURCE_LANG_REGEX.test(value)) return false;
  if (LOCKED_KEY_REGEX.test(key)) return true;
  return core.isLikelyIdentifier(value);
};

const shouldTranslateValue = (core, key, value, targetLang) =>
  core.shouldTranslateCellValue(key, value, targetLang, {
    shouldLockCell: (cellKey, cellValue) => shouldLockCell(core, cellKey, cellValue)
  });

const applyPostprocessRow = (core, original, translated, lang) => {
  const output = { ...translated };
  Object.entries(translated).forEach(([key, value]) => {
    if (typeof value !== "string") return;
    const originalValue = original?.[key];
    const lockValue = typeof originalValue === "string" ? originalValue : value;
    if (shouldLockCell(core, key, lockValue)) return;
    const sourceText = typeof originalValue === "string" ? originalValue : "";
    output[key] = core.polishTranslation(sourceText, value, lang);
  });
  return core.normalizeTerminology(output, lang, original);
};

const applyTargetText = (core, target, text, options) => {
  const restored = String(text ?? target.sourceText ?? "");
  const polished = dedupeLeadingRepeat(
    target.sourceText,
    core.polishTranslation(target.sourceText, restored, options.target)
  );
  target.setTarget(polished);
};

const toSemanticCandidates = (targets) =>
  targets
    .filter((target) => String(target.sourceText || "").trim() && String(target.getTarget() || "").trim())
    .map((target) => ({
      id: target.id,
      location: target.location,
      source: target.sourceText,
      target: target.getTarget(),
      length: target.sourceText.length
    }));

const createTranslationTasks = (records, context, targetLang, core) => {
  const tasks = [];
  const uniqueBySource = new Map();

  records.forEach((row, rowIndex) => {
    Object.entries(row).forEach(([key, value]) => {
      if (!shouldTranslateValue(core, key, value, targetLang)) return;
      const sourceText = String(value);
      const existing = uniqueBySource.get(sourceText);
      const follower = { rowIndex, key, location: getCellLocation(context, rowIndex, key) };
      if (existing) {
        existing.followers.push(follower);
        return;
      }
      const { sanitized, placeholders } = core.guardTranslationTokens(sourceText);
      const task = {
        id: `cell-${tasks.length + 1}`,
        sourceText,
        sanitized,
        placeholders,
        followers: [follower]
      };
      tasks.push(task);
      uniqueBySource.set(sourceText, task);
    });
  });

  return tasks;
};

const buildExcelRepairTargets = ({ sourceRows, translatedRows, context, targetLang, core }) => {
  const targets = [];
  sourceRows.forEach((sourceRow, rowIndex) => {
    Object.entries(sourceRow).forEach(([key, sourceValue]) => {
      if (!shouldTranslateValue(core, key, sourceValue, targetLang)) return;
      const sourceText = String(sourceValue || "");
      const location = getCellLocation(context, rowIndex, key);
      targets.push({
        id: `${rowIndex}:${key}`,
        qaKey: `${rowIndex}:${key}`,
        rowIndex,
        columnKey: key,
        location,
        sourceText,
        getTarget: () => String(translatedRows[rowIndex]?.[key] ?? ""),
        setTarget: (text) => {
          if (!translatedRows[rowIndex]) translatedRows[rowIndex] = {};
          translatedRows[rowIndex][key] = text;
        }
      });
    });
  });
  return targets;
};

const getTranslationOptions = (options) => {
  const profile = options.documentProfile || "spreadsheet";
  if (options.engine === "openrouter") {
    return {
      model: "openrouter",
      openRouterModel: options.model || undefined,
      profile
    };
  }
  if (options.engine === "auto") {
    return { profile };
  }
  return {
    model: "deepseek",
    providerModel: options.model || undefined,
    profile
  };
};

const translateWorkbook = async ({ filePath, options, core, hub }) => {
  const parsed = await readWorkbookWithContext(filePath, core);
  const sourceRows = parsed.records;
  const outputRows = sourceRows.map((row) => ({ ...row }));
  const tasks = createTranslationTasks(sourceRows, parsed.context, options.target, core);
  const batches = core.buildAdaptiveTextBatches({
    items: tasks,
    getText: (task) => task.sanitized,
    maxItems: options.batchSize,
    maxChars: options.batchChars
  });

  const startedAt = Date.now();
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const translated = await hub.translateBatch({
      records: batch.map((task) => ({ content: task.sanitized })),
      targetLang: options.target,
      options: getTranslationOptions(options)
    });

    batch.forEach((task, index) => {
      const rawTarget = translated[index]?.content;
      const restored = core.restoreTranslationTokens(
        typeof rawTarget === "string" ? rawTarget : task.sourceText,
        task.placeholders
      );
      const polished = core.polishTranslation(task.sourceText, restored, options.target);
      task.followers.forEach(({ rowIndex, key }) => {
        outputRows[rowIndex][key] = polished;
      });
    });

    console.log(
      `[translate] ${path.basename(filePath)} batch ${batchIndex + 1}/${batches.length}: ${batch.length} unique cells, engine=${hub.getLastEngine()}`
    );
  }

  const postprocessedRows = outputRows.map((row, index) =>
    applyPostprocessRow(core, sourceRows[index], row, options.target)
  );
  const repairTargets = buildExcelRepairTargets({
    sourceRows,
    translatedRows: postprocessedRows,
    context: parsed.context,
    targetLang: options.target,
    core
  });
  const qualityReport = core.runQualityChecks(sourceRows, postprocessedRows, {
    targetLang: options.target
  });

  return {
    documentKind: "excel",
    parsed,
    sourceRows,
    translatedRows: postprocessedRows,
    tasks,
    repairTargets,
    semanticCandidates: toSemanticCandidates(repairTargets),
    qualityReport,
    elapsedMs: Date.now() - startedAt
  };
};

const dedupeLeadingRepeat = (source, translated) => {
  const sourceTrimmed = String(source || "").trim();
  const targetTrimmed = String(translated || "").trim();
  if (!sourceTrimmed || targetTrimmed.length < 2) return translated;
  const first = targetTrimmed[0];
  const second = targetTrimmed[1];
  if (first.toLowerCase() !== second.toLowerCase()) return translated;
  const sourceFirst = sourceTrimmed[0];
  const sourceSecond = sourceTrimmed[1] || "";
  if (sourceFirst.toLowerCase() !== first.toLowerCase()) return translated;
  if (sourceSecond && sourceSecond.toLowerCase() === sourceFirst.toLowerCase()) return translated;
  const prefixLength = translated.length - String(translated).trimStart().length;
  const prefix = String(translated).slice(0, prefixLength);
  return `${prefix}${targetTrimmed.slice(1)}`;
};

const createTextTasks = (items, targetLang, core) => {
  const tasks = [];
  const uniqueBySource = new Map();
  items.forEach((item) => {
    const sourceText = String(item.sourceText || "");
    if (!core.shouldTranslateCellValue("", sourceText, targetLang, { ignoreLock: true })) return;
    const existing = uniqueBySource.get(sourceText);
    if (existing) {
      existing.followers.push(item);
      return;
    }
    const { sanitized, placeholders } = core.guardTranslationTokens(sourceText);
    const task = {
      id: `text-${tasks.length + 1}`,
      sourceText,
      sanitized,
      placeholders,
      followers: [item]
    };
    tasks.push(task);
    uniqueBySource.set(sourceText, task);
  });
  return tasks;
};

const translateTextTasks = async ({ filePath, items, options, core, hub }) => {
  const tasks = createTextTasks(items, options.target, core);
  const batches = core.buildAdaptiveTextBatches({
    items: tasks,
    getText: (task) => task.sanitized,
    maxItems: options.batchSize,
    maxChars: options.batchChars
  });

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const translated = await hub.translateBatch({
      records: batch.map((task) => ({ content: task.sanitized })),
      targetLang: options.target,
      options: getTranslationOptions(options)
    });

    batch.forEach((task, index) => {
      const rawTarget = translated[index]?.content;
      const restored = core.restoreTranslationTokens(
        typeof rawTarget === "string" ? rawTarget : task.sourceText,
        task.placeholders
      );
      task.followers.forEach((item) => applyTargetText(core, item, restored, options));
    });

    console.log(
      `[translate] ${path.basename(filePath)} batch ${batchIndex + 1}/${batches.length}: ${batch.length} unique text segments, engine=${hub.getLastEngine()}`
    );
  }
  return tasks;
};

const ensureDocxDomGlobals = () => {
  globalThis.DOMParser ||= DOMParser;
  globalThis.XMLSerializer ||= XMLSerializer;
};

const readDocxContext = async (filePath, core) => {
  ensureDocxDomGlobals();
  const bytes = await fs.readFile(filePath);
  const fileLike = {
    name: path.basename(filePath),
    arrayBuffer: async () => toArrayBuffer(bytes)
  };
  return core.parseDocxFile(fileLike);
};

const translateDocx = async ({ filePath, options, core, hub }) => {
  const startedAt = Date.now();
  const context = await readDocxContext(filePath, core);
  const items = context.segments
    .filter((segment) => String(core.getDocxSegmentText(segment) || segment.original).trim())
    .map((segment, index) => ({
      id: segment.id,
      qaKey: `${index}:content`,
      rowIndex: index,
      columnKey: "content",
      location: `${segment.partLabel}#${index + 1}`,
      sourceText: segment.original,
      getTarget: () => core.getDocxSegmentText(segment),
      setTarget: (text) => core.setDocxSegmentText(segment, text)
    }));

  const docxOptions = { ...options, documentProfile: "docx-manual" };
  const tasks = await translateTextTasks({ filePath, items, options: docxOptions, core, hub });
  const sourceRows = items.map((item) => ({ content: item.sourceText }));
  const translatedRows = items.map((item) => ({ content: item.getTarget() }));
  const qualityReport = core.runQualityChecks(sourceRows, translatedRows, { targetLang: options.target });

  return {
    documentKind: "docx",
    context,
    sourceRows,
    translatedRows,
    tasks,
    textTargets: items,
    repairTargets: items.filter((item) =>
      core.shouldTranslateCellValue("", item.sourceText, options.target, { ignoreLock: true })
    ),
    semanticCandidates: toSemanticCandidates(
      items.filter((item) =>
        core.shouldTranslateCellValue("", item.sourceText, options.target, { ignoreLock: true })
      )
    ),
    qualityReport,
    elapsedMs: Date.now() - startedAt
  };
};

const loadPdfModules = async () => {
  const [pdfjs, pdfLib, fontkit] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdf-lib"),
    import("@pdf-lib/fontkit")
  ]);
  return {
    pdfjs,
    PDFDocument: pdfLib.PDFDocument,
    rgb: pdfLib.rgb,
    fontkit: fontkit.default || fontkit
  };
};

const mergePdfTextItems = (items, viewport, pageNumber) => {
  const lines = [];
  const positioned = items
    .map((item) => {
      const text = item.str || "";
      if (!text.trim() || !item.transform) return null;
      const [, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
      const [x, baselineY] = viewport.convertToViewportPoint(e, f);
      const fontSize = Math.max(4, item.height || Math.hypot(b, d) || 10);
      return {
        text,
        x,
        y: Math.max(0, baselineY - fontSize),
        width: Math.max(1, item.width || text.length * fontSize * 0.5),
        height: Math.max(1, item.height || Math.hypot(c, d) || fontSize),
        fontSize
      };
    })
    .filter(Boolean)
    .sort((a, b) => (Math.abs(a.y - b.y) < 3 ? a.x - b.x : a.y - b.y));

  positioned.forEach((item) => {
    const line = lines.find((candidate) => {
      const sameLine = Math.abs(candidate.y - item.y) <= Math.max(4, item.fontSize * 0.35);
      const gap = item.x - (candidate.x + candidate.width);
      return sameLine && gap <= Math.max(18, item.fontSize * 3.5);
    });
    if (!line) {
      lines.push({ ...item });
      return;
    }
    const gap = item.x - (line.x + line.width);
    const separator = gap > Math.max(1, item.fontSize * 0.22) && !/\s$/.test(line.text) ? " " : "";
    line.text = `${line.text}${separator}${item.text}`;
    const right = Math.max(line.x + line.width, item.x + item.width);
    line.width = right - line.x;
    line.height = Math.max(line.height, item.y + item.height - line.y);
    line.fontSize = Math.max(line.fontSize, item.fontSize);
  });

  return lines
    .filter((line) => line.text.trim())
    .map((line, index) => ({
      id: `pdf-page-${pageNumber}-segment-${index}`,
      pageNumber,
      original: line.text.trim(),
      translated: "",
      x: line.x,
      y: line.y,
      width: Math.max(line.width, 24),
      height: Math.max(line.height, line.fontSize * 1.4),
      fontSize: line.fontSize
    }));
};

const readPdfContext = async (filePath, pdfModules) => {
  const sourceData = new Uint8Array(await fs.readFile(filePath));
  const standardFontDataUrl = `${resolveRepoPath("node_modules/pdfjs-dist/standard_fonts")}${path.sep}`;
  const pdf = await pdfModules.pdfjs.getDocument({ data: sourceData.slice(), standardFontDataUrl }).promise;
  const pages = [];
  const segments = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const pageSegments = mergePdfTextItems(textContent.items || [], viewport, pageNumber);
    pageSegments.forEach((segment) => segments.push(segment));
    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      segments: pageSegments
    });
  }
  return {
    fileName: path.basename(filePath),
    sourceData,
    pageCount: pdf.numPages,
    pages,
    segments,
    coverageWarnings: []
  };
};

const getPdfSegmentText = (segment) => segment.translated || segment.original;

const translatePdf = async ({ filePath, options, core, hub, pdfModules }) => {
  const startedAt = Date.now();
  const context = await readPdfContext(filePath, pdfModules);
  const items = context.segments
    .filter((segment) => String(segment.original || "").trim())
    .map((segment, index) => ({
      id: segment.id,
      qaKey: `${index}:content`,
      rowIndex: index,
      columnKey: "content",
      location: `Page ${segment.pageNumber}#${index + 1}`,
      sourceText: segment.original,
      getTarget: () => getPdfSegmentText(segment),
      setTarget: (text) => {
        segment.translated = text;
      }
    }));

  const pdfOptions = { ...options, documentProfile: "docx-manual" };
  const tasks = await translateTextTasks({ filePath, items, options: pdfOptions, core, hub });
  const sourceRows = items.map((item) => ({ content: item.sourceText }));
  const translatedRows = items.map((item) => ({ content: item.getTarget() }));
  const qualityReport = core.runQualityChecks(sourceRows, translatedRows, { targetLang: options.target });

  return {
    documentKind: "pdf",
    context,
    sourceRows,
    translatedRows,
    tasks,
    textTargets: items,
    repairTargets: items.filter((item) =>
      core.shouldTranslateCellValue("", item.sourceText, options.target, { ignoreLock: true })
    ),
    semanticCandidates: toSemanticCandidates(
      items.filter((item) =>
        core.shouldTranslateCellValue("", item.sourceText, options.target, { ignoreLock: true })
      )
    ),
    qualityReport,
    elapsedMs: Date.now() - startedAt
  };
};

const hasHardQualityFailures = (report) => {
  const totals = report.totals || {};
  return [
    totals.chineseCells,
    totals.placeholderCells,
    totals.idMismatches,
    totals.emptyTranslations,
    totals.structureMismatches,
    totals.nonTargetCells
  ].some((value) => Number(value || 0) > 0);
};

const refreshTranslatedChecks = (translated, core, options) => {
  if (translated.documentKind !== "excel") {
    translated.translatedRows = (translated.textTargets || translated.repairTargets).map((target) => ({
      content: target.getTarget()
    }));
  }
  translated.qualityReport = core.runQualityChecks(translated.sourceRows, translated.translatedRows, {
    targetLang: options.target
  });
  translated.semanticCandidates = toSemanticCandidates(translated.repairTargets || []);
};

const getHardRepairIssues = (qualityReport) => {
  const issues = qualityReport.issues || {};
  return [
    ...(issues.idMismatch || []).map((issue) => ({ ...issue, repairKind: "restore-source" })),
    ...(issues.chinese || []).map((issue) => ({ ...issue, repairKind: "retranslate" })),
    ...(issues.nonTargetLanguage || []).map((issue) => ({ ...issue, repairKind: "retranslate" })),
    ...(issues.emptyTranslations || []).map((issue) => ({ ...issue, repairKind: "retranslate" })),
    ...(issues.placeholders || []).map((issue) => ({ ...issue, repairKind: "retranslate" }))
  ];
};

const translateRepairTargets = async ({ targets, options, core, hub, reason }) => {
  const uniqueTargets = Array.from(new Map(targets.map((target) => [target.id, target])).values());
  const batches = core.buildAdaptiveTextBatches({
    items: uniqueTargets,
    getText: (target) => target.sourceText,
    maxItems: Math.min(options.batchSize, 8),
    maxChars: Math.min(options.batchChars, 6000)
  });

  let repaired = 0;
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const guarded = batch.map((target) => ({
      target,
      ...core.guardTranslationTokens(target.sourceText)
    }));
    const translatedBatch = await hub.translateBatch({
      records: guarded.map((item) => ({ content: item.sanitized })),
      targetLang: options.target,
      options: getTranslationOptions(options)
    });
    guarded.forEach((item, index) => {
      const rawTarget = translatedBatch[index]?.content;
      const restored = core.restoreTranslationTokens(
        typeof rawTarget === "string" ? rawTarget : item.target.sourceText,
        item.placeholders
      );
      applyTargetText(core, item.target, restored, options);
      repaired += 1;
    });
    console.log(
      `[repair] ${reason} batch ${batchIndex + 1}/${batches.length}: ${batch.length} target(s), engine=${hub.getLastEngine()}`
    );
  }
  return repaired;
};

const isUsableFullSegmentSuggestion = (target, suggestion) => {
  const normalizedSuggestion = normalizeComparableText(suggestion);
  if (!normalizedSuggestion) return false;
  const normalizedCurrent = normalizeComparableText(target.getTarget());
  const normalizedSource = normalizeComparableText(target.sourceText);
  if (normalizedSource.length < 40 || !normalizedCurrent) return true;
  return normalizedSuggestion.length >= Math.floor(normalizedCurrent.length * 0.65);
};

const applyRepairRound = async ({ translated, semanticReview, options, core, hub, round }) => {
  const targetByQaKey = new Map((translated.repairTargets || []).map((target) => [target.qaKey, target]));
  const targetById = new Map((translated.repairTargets || []).map((target) => [target.id, target]));
  const actions = [];
  const modelTargets = new Map();

  getHardRepairIssues(translated.qualityReport).forEach((issue) => {
    const target = targetByQaKey.get(`${issue.rowIndex}:${issue.columnKey}`);
    if (!target) return;
    if (issue.repairKind === "restore-source") {
      target.setTarget(target.sourceText);
      actions.push({
        round,
        type: "hard-qa",
        repair: "restore-source",
        targetId: target.id,
        location: target.location,
        issueType: issue.type
      });
      return;
    }
    modelTargets.set(target.id, target);
    actions.push({
      round,
      type: "hard-qa",
      repair: "model-retranslate",
      targetId: target.id,
      location: target.location,
      issueType: issue.type
    });
  });

  (semanticReview.reviews || [])
    .filter((review) => review.verdict === "warning" || review.verdict === "fail")
    .forEach((review) => {
      const target = targetById.get(review.id);
      if (!target) return;
      if (review.suggestion && isUsableFullSegmentSuggestion(target, review.suggestion)) {
        applyTargetText(core, target, review.suggestion, options);
        actions.push({
          round,
          type: "semantic",
          repair: "review-suggestion",
          targetId: target.id,
          location: target.location,
          verdict: review.verdict,
          issueTypes: review.issueTypes || []
        });
        return;
      }
      modelTargets.set(target.id, target);
      actions.push({
        round,
        type: "semantic",
        repair: "model-retranslate",
        targetId: target.id,
        location: target.location,
        verdict: review.verdict,
        issueTypes: review.issueTypes || []
      });
    });

  if (modelTargets.size > 0) {
    await translateRepairTargets({
      targets: Array.from(modelTargets.values()),
      options,
      core,
      hub,
      reason: `round ${round}`
    });
  }

  return actions;
};

const summarizeSemanticReviews = ({ mode, candidateCount, errors = [], reviews }) => {
  const counts = reviews.reduce(
    (acc, item) => {
      acc[item.verdict] = (acc[item.verdict] || 0) + 1;
      return acc;
    },
    { pass: 0, warning: 0, fail: 0 }
  );
  return {
    mode,
    candidateCount,
    reviewedCount: reviews.length,
    counts,
    status: errors.length ? "review-error" : counts.fail > 0 ? "failed" : counts.warning > 0 ? "warning" : "passed",
    errors,
    reviews
  };
};

const mergeSemanticReview = (previous, incremental) => {
  if (!previous) return incremental;
  const byId = new Map((previous.reviews || []).map((review) => [review.id, review]));
  (incremental.reviews || []).forEach((review) => {
    byId.set(review.id, review);
  });
  const previousOrder = (previous.reviews || []).map((review) => review.id);
  const reviews = [
    ...previousOrder.filter((id) => byId.has(id)).map((id) => byId.get(id)),
    ...(incremental.reviews || []).filter((review) => !previousOrder.includes(review.id))
  ].filter(Boolean);
  return summarizeSemanticReviews({
    mode: previous.mode,
    candidateCount: previous.candidateCount,
    errors: [...(previous.errors || []), ...(incremental.errors || [])],
    reviews
  });
};

const runQualityRepairLoop = async ({ translated, options, core, hub, reviewer }) => {
  const repairLog = [];
  let semanticReview = null;
  let pendingSemanticReviewIds = null;

  for (let round = 0; round <= options.maxRepairRounds; round += 1) {
    refreshTranslatedChecks(translated, core, options);
    const reviewCandidates = pendingSemanticReviewIds
      ? translated.semanticCandidates.filter((candidate) => pendingSemanticReviewIds.has(candidate.id))
      : translated.semanticCandidates;
    const incrementalReview = await runSemanticReview({
      candidates: reviewCandidates,
      options,
      reviewer,
      core
    });
    semanticReview = pendingSemanticReviewIds
      ? mergeSemanticReview(semanticReview, incrementalReview)
      : incrementalReview;
    pendingSemanticReviewIds = null;

    const hardFailed = hasHardQualityFailures(translated.qualityReport);
    const semanticFailed = semanticReview.status === "failed" || semanticReview.status === "warning" || semanticReview.status === "review-error";
    if (!hardFailed && !semanticFailed) {
      return { semanticReview, repairLog, repairStatus: "passed" };
    }
    if (round >= options.maxRepairRounds) {
      repairLog.push({
        round,
        type: "stop",
        reason: "max-repair-rounds",
        hardFailed,
        semanticStatus: semanticReview.status
      });
      return { semanticReview, repairLog, repairStatus: "max-rounds" };
    }

    const actions = await applyRepairRound({
      translated,
      semanticReview,
      options,
      core,
      hub,
      round: round + 1
    });
    repairLog.push(...actions);
    pendingSemanticReviewIds = new Set(
      actions.map((action) => action.targetId).filter(Boolean)
    );
    if (!actions.length) {
      repairLog.push({
        round,
        type: "stop",
        reason: "no-actionable-repair",
        hardFailed,
        semanticStatus: semanticReview.status
      });
      return { semanticReview, repairLog, repairStatus: "no-actionable-repair" };
    }
    if (!pendingSemanticReviewIds.size) {
      pendingSemanticReviewIds = null;
    }
  }

  return { semanticReview, repairLog, repairStatus: "unknown" };
};

const selectSemanticSamples = (candidates, options) => {
  if (options.semantic === "full" || candidates.length <= options.reviewSampleSize) {
    return candidates;
  }

  const selected = new Map();
  candidates
    .slice()
    .sort((a, b) => b.length - a.length)
    .slice(0, Math.ceil(options.reviewSampleSize / 3))
    .forEach((item) => selected.set(item.id, item));

  const remainingSlots = options.reviewSampleSize - selected.size;
  const stride = Math.max(1, Math.floor(candidates.length / Math.max(1, remainingSlots)));
  for (let i = 0; i < candidates.length && selected.size < options.reviewSampleSize; i += stride) {
    selected.set(candidates[i].id, candidates[i]);
  }
  for (const item of candidates) {
    if (selected.size >= options.reviewSampleSize) break;
    selected.set(item.id, item);
  }
  return Array.from(selected.values()).sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b));
};

const normalizeComparableText = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();

const normalizeReviewResult = ({ sample, review, result, core, options }) => {
  const rawVerdict = review?.verdict || "warning";
  const suggestion = review?.suggestion || "";
  const polishedSuggestion = suggestion
    ? core.polishTranslation(sample.source, suggestion, options.target)
    : "";
  const suggestionMatchesTarget =
    suggestion &&
    normalizeComparableText(polishedSuggestion) === normalizeComparableText(sample.target);
  const verdict = rawVerdict !== "pass" && suggestionMatchesTarget ? "pass" : rawVerdict;
  return {
    ...sample,
    verdict,
    risk: verdict === "pass" ? "low" : review?.risk || "medium",
    issueTypes: verdict === "pass" ? [] : review?.issueTypes || ["review-missing"],
    comment:
      verdict === "pass" && suggestionMatchesTarget
        ? "AI 语义审查建议经本地后处理后与当前译文一致，视为已收敛。"
        : review?.comment || "AI 语义审查未返回该样本结果，需人工复核。",
    suggestion: verdict === "pass" && suggestionMatchesTarget ? "" : suggestion,
    model: result.model,
    engine: result.engine
  };
};

const runSemanticReview = async ({ candidates, options, reviewer, core }) => {
  const samples = selectSemanticSamples(candidates, options);
  const reviews = [];
  const errors = [];

  for (let i = 0; i < samples.length; i += options.reviewBatchSize) {
    const batch = samples.slice(i, i + options.reviewBatchSize);
    try {
      const result = await reviewer.reviewSamples(batch, options.target, options.reviewModel || undefined);
      const byId = new Map((result.reviews || []).map((item) => [item.id, item]));
      batch.forEach((sample) => {
        const review = byId.get(sample.id);
        reviews.push(normalizeReviewResult({ sample, review, result, core, options }));
      });
      console.log(`[semantic] reviewed ${Math.min(i + batch.length, samples.length)}/${samples.length} samples`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      batch.forEach((sample) => {
        reviews.push({
          ...sample,
          verdict: "warning",
          risk: "medium",
          issueTypes: ["review-error"],
          comment: "AI 语义审查调用失败，需人工复核。",
          suggestion: "",
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }
  }

  const counts = reviews.reduce(
    (acc, item) => {
      acc[item.verdict] = (acc[item.verdict] || 0) + 1;
      return acc;
    },
    { pass: 0, warning: 0, fail: 0 }
  );

  return {
    mode: options.semantic,
    candidateCount: candidates.length,
    reviewedCount: reviews.length,
    counts,
    status: errors.length ? "review-error" : counts.fail > 0 ? "failed" : counts.warning > 0 ? "warning" : "passed",
    errors,
    reviews
  };
};

const buildMarkdownReport = ({ fileName, outputPath, reportPath, qualityReport, semanticReview, repairLog, repairStatus, exportStats, overallStatus, elapsedMs }) => {
  const totals = qualityReport.totals;
  const topSemanticIssues = semanticReview.reviews
    .filter((item) => item.verdict !== "pass")
    .slice(0, 20);
  const lines = [
    `# Local Agent Translation Report: ${fileName}`,
    "",
    `- Overall status: ${overallStatus}`,
    `- Output: ${outputPath}`,
    `- JSON report: ${reportPath}`,
    `- Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`,
    `- Repair status: ${repairStatus}`,
    `- Repair actions: ${repairLog.length}`,
    "",
    "## Hard QA",
    "",
    `- Chinese residue cells: ${totals.chineseCells}`,
    `- Non-target cells: ${totals.nonTargetCells}`,
    `- Empty translations: ${totals.emptyTranslations}`,
    `- Placeholder/code issues: ${totals.placeholderCells}`,
    `- ID mismatches: ${totals.idMismatches}`,
    `- Structure mismatches: ${totals.structureMismatches}`,
    `- Spacing issues: ${totals.spacingIssues}`,
    "",
    "## Semantic Review",
    "",
    `- Mode: ${semanticReview.mode}`,
    `- Candidates: ${semanticReview.candidateCount}`,
    `- Reviewed: ${semanticReview.reviewedCount}`,
    `- Pass: ${semanticReview.counts.pass || 0}`,
    `- Warning: ${semanticReview.counts.warning || 0}`,
    `- Fail: ${semanticReview.counts.fail || 0}`,
    `- Status: ${semanticReview.status}`,
    "",
    "## Export",
    "",
    `- Style preserved: ${exportStats.stylePreserved ? "yes" : "no"}`,
    `- Overwritten formulas: ${exportStats.overwrittenFormulas || 0}`,
    `- Skipped formulas: ${exportStats.skippedFormulas || 0}`
  ];

  if (semanticReview.errors.length) {
    lines.push("", "## Semantic Review Errors", "", ...semanticReview.errors.map((item) => `- ${item}`));
  }

  if (repairLog.length) {
    lines.push("", "## Auto Repair Log", "");
    repairLog.slice(0, 80).forEach((item) => {
      lines.push(
        `- Round ${item.round}: ${item.type}/${item.repair || item.reason} ${item.location || ""}`.trim()
      );
    });
  }

  if (topSemanticIssues.length) {
    lines.push("", "## Semantic Issues For Manual Review", "");
    topSemanticIssues.forEach((item) => {
      lines.push(
        `- ${item.location} [${item.verdict}/${item.risk}] ${item.issueTypes.join(", ")}: ${item.comment}`,
        `  - Source: ${item.source}`,
        `  - Target: ${item.target}`,
        item.suggestion ? `  - Suggestion: ${item.suggestion}` : ""
      );
    });
  }

  return lines.filter((line) => line !== "").join("\n") + "\n";
};

const writeWorkbookOutput = async ({ translatedRows, context, outputPath, core }) => {
  const { bytes, stats } = await core.buildStylePreservingExcelBuffer(translatedRows, context, {
    overwriteFormulas: true
  });
  await fs.writeFile(outputPath, bytes);
  return stats;
};

const findPdfFontPath = async () => {
  const candidates = [
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    resolveRepoPath("public/fonts/NotoSansHans-Regular.otf"),
    resolveRepoPath("node_modules/@embedpdf/fonts-sc/fonts/NotoSansHans-Regular.otf")
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next font candidate.
    }
  }
  return null;
};

const wrapPdfLines = (font, text, maxWidth, fontSize) => {
  const output = [];
  String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((paragraph) => {
      let current = "";
      paragraph.split(/\s+/).filter(Boolean).forEach((word) => {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth || !current) {
          current = candidate;
          return;
        }
        output.push(current);
        current = word;
      });
      if (current) output.push(current);
    });
  return output.length ? output : [String(text || "")];
};

const writePdfOutput = async ({ context, outputPath, pdfModules }) => {
  const { PDFDocument, rgb, fontkit } = pdfModules;
  const source = await PDFDocument.load(context.sourceData);
  const output = await PDFDocument.create();
  output.registerFontkit(fontkit);
  const fontPath = await findPdfFontPath();
  if (!fontPath) {
    throw new Error("No embeddable PDF font found for local agent export.");
  }
  const font = await output.embedFont(await fs.readFile(fontPath), { subset: true });
  const sourcePages = await output.embedPages(source.getPages());

  for (const pageContext of context.pages) {
    const sourcePage = sourcePages[pageContext.pageNumber - 1];
    const page = output.addPage([pageContext.width, pageContext.height]);
    page.drawPage(sourcePage, {
      x: 0,
      y: 0,
      width: pageContext.width,
      height: pageContext.height
    });

    pageContext.segments.forEach((segment) => {
      const text = String(getPdfSegmentText(segment) || "").trim();
      if (!text) return;
      const fontSize = Math.max(5, Math.min(14, segment.fontSize || 10));
      const width = Math.max(24, Math.min(pageContext.width - segment.x - 8, segment.width || 120));
      const height = Math.max(fontSize * 1.5, segment.height || fontSize * 1.5);
      const x = Math.max(0, segment.x);
      const y = Math.max(0, pageContext.height - segment.y - height);
      page.drawRectangle({
        x,
        y,
        width,
        height: Math.min(pageContext.height - y, height * 1.35),
        color: rgb(1, 1, 1)
      });
      const lines = wrapPdfLines(font, text, Math.max(12, width - 4), fontSize).slice(0, 3);
      lines.forEach((line, index) => {
        page.drawText(line, {
          x: x + 2,
          y: y + Math.max(1, height - fontSize - index * fontSize * 1.15),
          size: fontSize,
          font,
          color: rgb(0.08, 0.09, 0.12),
          maxWidth: width - 4
        });
      });
    });
  }

  await fs.writeFile(outputPath, await output.save());
  return {
    overwrittenFormulas: 0,
    skippedFormulas: 0,
    stylePreserved: true,
    fontPath: path.relative(repoRoot, fontPath).startsWith("..") ? fontPath : path.relative(repoRoot, fontPath)
  };
};

const writeTranslatedOutput = async ({ translated, outputPath, core, pdfModules }) => {
  if (translated.documentKind === "excel") {
    return writeWorkbookOutput({
      translatedRows: translated.translatedRows,
      context: translated.parsed.context,
      outputPath,
      core
    });
  }
  if (translated.documentKind === "docx") {
    ensureDocxDomGlobals();
    await fs.writeFile(outputPath, await core.buildDocxTranslationBuffer(translated.context));
    return { overwrittenFormulas: 0, skippedFormulas: 0, stylePreserved: true };
  }
  if (translated.documentKind === "pdf") {
    return writePdfOutput({ context: translated.context, outputPath, pdfModules });
  }
  throw new Error(`Unsupported document kind: ${translated.documentKind}`);
};

const getDocumentKind = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (EXCEL_EXTENSIONS.has(ext)) return "excel";
  if (ext === ".docx") return "docx";
  if (ext === ".pdf") return "pdf";
  throw new Error(`Unsupported file type: ${filePath}`);
};

const translateDocument = async ({ filePath, options, core, hub, pdfModules }) => {
  const documentKind = getDocumentKind(filePath);
  if (documentKind === "excel") {
    return translateWorkbook({ filePath, options, core, hub });
  }
  if (documentKind === "docx") {
    return translateDocx({ filePath, options, core, hub });
  }
  return translatePdf({ filePath, options, core, hub, pdfModules });
};

const processFile = async ({ filePath, options, core, hub, reviewer, outputDir, reportDir, pdfModules }) => {
  console.log(`[file] ${path.basename(filePath)} -> ${options.target}`);
  const translated = await translateDocument({ filePath, options, core, hub, pdfModules });
  const { semanticReview, repairLog, repairStatus } = await runQualityRepairLoop({
    translated,
    options,
    core,
    hub,
    reviewer
  });

  const baseName = path.basename(filePath);
  const outputPath = path.join(outputDir, `Translated_${options.target}_${baseName}`);
  const reportBase = `${path.basename(baseName, path.extname(baseName))}_${translated.documentKind}_${options.target}`;
  const reportPath = path.join(reportDir, `${reportBase}.json`);
  const markdownPath = path.join(reportDir, `${reportBase}.md`);
  const hardFailed = hasHardQualityFailures(translated.qualityReport);
  const semanticFailed = semanticReview.status === "failed" || semanticReview.status === "review-error";
  const overallStatus = hardFailed || semanticFailed
    ? "failed"
    : semanticReview.status === "warning"
      ? "needs_review"
      : "passed";

  let exportStats = { overwrittenFormulas: 0, skippedFormulas: 0, stylePreserved: false };
  if (!options.dryRun) {
    exportStats = await writeTranslatedOutput({ translated, outputPath, core, pdfModules });
  }

  const report = {
    schema: "poct.local_agent_translation_report.v1",
    createdAt: new Date().toISOString(),
    file: path.relative(repoRoot, filePath),
    documentKind: translated.documentKind,
    targetLang: options.target,
    output: options.dryRun ? null : path.relative(repoRoot, outputPath),
    status: overallStatus,
    translation: {
      uniqueTasks: translated.tasks.length,
      elapsedMs: translated.elapsedMs,
      engine: hub.getLastEngine()
    },
    hardQa: translated.qualityReport,
    semanticReview,
    repair: {
      status: repairStatus,
      maxRounds: options.maxRepairRounds,
      actions: repairLog
    },
    exportStats,
    dryRun: options.dryRun
  };

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(
    markdownPath,
    buildMarkdownReport({
      fileName: baseName,
      outputPath: options.dryRun ? "(dry-run)" : path.relative(repoRoot, outputPath),
      reportPath: path.relative(repoRoot, reportPath),
      qualityReport: translated.qualityReport,
      semanticReview,
      repairLog,
      repairStatus,
      exportStats,
      overallStatus,
      elapsedMs: translated.elapsedMs
    }),
    "utf8"
  );

  console.log(`[done] ${baseName}: ${overallStatus}, report=${path.relative(repoRoot, reportPath)}`);
  return report;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.target) {
    throw new Error(`Missing target language.\n${usage()}`);
  }

  await loadEnv();
  const inputDir = resolveRepoPath(options.input);
  const outputDir = resolveRepoPath(options.output);
  const reportDir = resolveRepoPath(options.reports);
  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(reportDir, { recursive: true });

  const files = await listDocumentFiles(inputDir);
  if (!files.length) {
    console.log(`No Excel, DOCX, or PDF files found in ${path.relative(repoRoot, inputDir)}.`);
    return;
  }

  const core = await loadCoreModules();
  const pdfModules = await loadPdfModules();
  const hub = new core.TranslationHub();
  const reviewer = new core.SampleReviewAuditService();
  const reports = [];

  for (const filePath of files) {
    reports.push(await processFile({ filePath, options, core, hub, reviewer, outputDir, reportDir, pdfModules }));
  }

  const summary = {
    schema: "poct.local_agent_translation_summary.v1",
    createdAt: new Date().toISOString(),
    targetLang: options.target,
    input: path.relative(repoRoot, inputDir),
    output: path.relative(repoRoot, outputDir),
    reports: path.relative(repoRoot, reportDir),
    totalFiles: reports.length,
    passed: reports.filter((item) => item.status === "passed").length,
    needsReview: reports.filter((item) => item.status === "needs_review").length,
    failed: reports.filter((item) => item.status === "failed").length,
    files: reports.map((item) => ({
      file: item.file,
      documentKind: item.documentKind,
      output: item.output,
      status: item.status,
      hardQa: item.hardQa.totals,
      semantic: {
        status: item.semanticReview.status,
        reviewedCount: item.semanticReview.reviewedCount,
        counts: item.semanticReview.counts
      },
      repair: {
        status: item.repair.status,
        actionCount: item.repair.actions.length
      }
    }))
  };
  const summaryPath = path.join(reportDir, `summary_${options.target}_${Date.now()}.json`);
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`[summary] ${path.relative(repoRoot, summaryPath)}`);

  if (summary.failed > 0) {
    process.exitCode = 2;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
