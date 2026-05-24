import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import JSZip from "jszip";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const repoRoot = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(repoRoot, "fixtures/real-document-regression.json");

const realPath = (...parts) => path.join(repoRoot, ...parts);

const exists = (filePath) => fs.existsSync(filePath);

const firstExisting = (candidates) => candidates.find((candidate) => candidate && exists(candidate)) || null;

const loadManifest = () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schema !== "poct.real_document_regression.v1") {
    throw new Error(`Unsupported real document regression schema: ${manifest.schema}`);
  }
  return manifest;
};

const manifest = loadManifest();

const findCase = (id) => {
  const item = manifest.cases.find((entry) => entry.id === id);
  if (!item) throw new Error(`Missing real document regression case: ${id}`);
  return item;
};

const resolveLocalPath = (relativePath) => path.join(repoRoot, relativePath);

const resolveLocalCandidates = (relativePaths = []) => relativePaths.map(resolveLocalPath);

const check = (name, passed, details = {}) => ({ name, passed: Boolean(passed), ...details });

const summarizeChecks = (checks = []) => {
  if (checks.length === 0) return "not-checked";
  return checks.every((item) => item.passed) ? "passed" : "warning";
};

const listPdfFiles = (dirPath) => {
  if (!exists(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((name) => /\.pdf$/i.test(name))
    .map((name) => path.join(dirPath, name));
};

const bundleTsModule = async (sourcePath) => {
  const tmpDir = fs.mkdtempSync(path.join(repoRoot, ".tmp-real-smoke-"));
  const outputPath = path.join(tmpDir, `${path.basename(sourcePath, ".ts")}.mjs`);
  try {
    await esbuild.build({
      entryPoints: [sourcePath],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      outfile: outputPath,
      external: ["xlsx", "jszip", "docx", "pdfjs-dist", "pdf-lib", "@pdf-lib/fontkit"],
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

const decodeXmlText = (value) =>
  String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const extractDocxParagraphs = async (filePath) => {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const partNames = Object.keys(zip.files)
    .filter((name) =>
      /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(name)
    )
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const paragraphs = [];
  for (const partName of partNames) {
    const xml = await zip.file(partName).async("text");
    const paragraphMatches = xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
    paragraphMatches.forEach((paragraphXml) => {
      const text = Array.from(paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
        .map((match) => decodeXmlText(match[1]))
        .join("");
      if (text.trim()) {
        paragraphs.push({ partName, text: text.replace(/\s+/g, " ").trim() });
      }
    });
  }
  return paragraphs;
};

const inspectDocxNumbering = async (filePath) => {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const numbering = zip.file("word/numbering.xml");
  if (!numbering) {
    return { hasNumbering: false, cjkFormats: 0, cjkSeparators: 0 };
  }
  const xml = await numbering.async("text");
  const cjkFormats = (xml.match(/w:numFmt[^>]+w:val="(?:chinese|japanese|korean|taiwanese|ideograph)[^"]*"/gi) || []).length;
  const cjkSeparators = (xml.match(/w:lvlText[^>]+w:val="[^"]*[一二三四五六七八九十百千万零〇%][、。．][^"]*"/g) || []).length;
  return { hasNumbering: true, cjkFormats, cjkSeparators };
};

const commandText = (command, args) =>
  execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

const pdfInfo = (filePath) => {
  const raw = commandText("pdfinfo", [filePath]);
  const pages = Number(raw.match(/^Pages:\s+(\d+)/m)?.[1] || 0);
  const pageSize = raw.match(/^Page size:\s+(.+)$/m)?.[1] || "";
  return { pages, pageSize };
};

const pdfTextLength = (filePath) => {
  const text = commandText("pdftotext", ["-layout", filePath, "-"]);
  return {
    chars: text.replace(/\s+/g, "").length,
    preview: text.replace(/\s+/g, " ").trim().slice(0, 180)
  };
};

const renderPdfFirstPage = (filePath) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "poct-pdf-render-"));
  const prefix = path.join(outDir, "page");
  commandText("pdftoppm", ["-f", "1", "-singlefile", "-png", filePath, prefix]);
  const output = `${prefix}.png`;
  const size = fs.existsSync(output) ? fs.statSync(output).size : 0;
  fs.rmSync(outDir, { recursive: true, force: true });
  return size;
};

const runExcelSmoke = async () => {
  const caseConfig = findCase("excel-ba512-english-smoke");
  const sourcePath = resolveLocalPath(caseConfig.localPaths.source);
  const translatedPath = resolveLocalPath(caseConfig.localPaths.translated);
  if (!sourcePath || !translatedPath || !exists(sourcePath) || !exists(translatedPath)) {
    return { caseId: caseConfig.id, skipped: true, status: "skipped", reason: "Excel sample files not found." };
  }
  const { parseExcelWorkbook, exportToExcel } = await bundleTsModule(realPath("utils/excel.ts"));
  const { runQualityChecks } = await bundleTsModule(realPath("utils/quality.ts"));
  const source = parseExcelWorkbook(XLSX.readFile(sourcePath, { cellStyles: true }));
  const translated = parseExcelWorkbook(XLSX.readFile(translatedPath, { cellStyles: true }));
  const report = runQualityChecks(source.records, translated.records, { targetLang: caseConfig.targetLang });
  const outPath = path.join(os.tmpdir(), `poct-real-excel-${Date.now()}.xlsx`);
  const exportStats = exportToExcel(translated.records, outPath, source.context, {
    overwriteFormulas: true
  });
  const exported = XLSX.readFile(outPath, { cellStyles: true });
  const exportedSheets = exported.SheetNames.length;
  fs.rmSync(outPath, { force: true });
  const expectations = caseConfig.expectations || {};
  const checks = [
    check("source rows meet baseline", source.records.length >= (expectations.minSourceRows || 0), {
      actual: source.records.length,
      expected: expectations.minSourceRows || 0
    }),
    check("exported sheet count matches source", !expectations.exportedSheetsMustMatchSource || exportedSheets === source.context.sheets.length, {
      actual: exportedSheets,
      expected: source.context.sheets.length
    }),
    check("Chinese residue cells within baseline", report.totals.chineseCells <= (expectations.maxChineseCells ?? Number.POSITIVE_INFINITY), {
      actual: report.totals.chineseCells,
      expectedMax: expectations.maxChineseCells
    }),
    check("placeholder issue cells within baseline", report.totals.placeholderCells <= (expectations.maxPlaceholderCells ?? Number.POSITIVE_INFINITY), {
      actual: report.totals.placeholderCells,
      expectedMax: expectations.maxPlaceholderCells
    }),
    check("empty translations within baseline", report.totals.emptyTranslations <= (expectations.maxEmptyTranslations ?? Number.POSITIVE_INFINITY), {
      actual: report.totals.emptyTranslations,
      expectedMax: expectations.maxEmptyTranslations
    }),
    check("structure mismatches within baseline", report.totals.structureMismatches <= (expectations.maxStructureMismatches ?? Number.POSITIVE_INFINITY), {
      actual: report.totals.structureMismatches,
      expectedMax: expectations.maxStructureMismatches
    })
  ];
  return {
    caseId: caseConfig.id,
    skipped: false,
    status: summarizeChecks(checks),
    sourceRows: source.records.length,
    translatedRows: translated.records.length,
    sheets: source.context.sheets.length,
    exportedSheets,
    quality: report.totals,
    exportStats,
    checks
  };
};

const runDocxSmoke = async () => {
  const caseConfig = findCase("docx-russian-residual-baseline");
  const russianPath = resolveLocalPath(caseConfig.localPaths.translated);
  if (!exists(russianPath)) {
    return { caseId: caseConfig.id, skipped: true, status: "skipped", reason: "DOCX Russian sample file not found." };
  }
  const { isLikelyTargetLanguage } = await bundleTsModule(realPath("utils/language.ts"));
  const paragraphs = await extractDocxParagraphs(russianPath);
  const issueParagraphs = paragraphs.filter((item) => !isLikelyTargetLanguage(item.text, "Russian"));
  const commonEnglishResiduals = paragraphs.filter((item) =>
    /\b(?:List|Building|Street|District|City|Province|feces|service|reference|establish|uncertain|White Blood Cell Count)\b/i.test(item.text)
  );
  const numbering = await inspectDocxNumbering(russianPath);
  const expectations = caseConfig.expectations || {};
  const knownResidualTerms = expectations.knownResidualTerms || [];
  const knownResidualHits = knownResidualTerms
    .map((term) => ({
      term,
      hits: paragraphs.filter((item) => item.text.toLowerCase().includes(String(term).toLowerCase())).length
    }))
    .filter((item) => item.hits > 0);
  const checks = [
    check("paragraph count meets baseline", paragraphs.length >= (expectations.minParagraphs || 0), {
      actual: paragraphs.length,
      expected: expectations.minParagraphs || 0
    }),
    check("CJK numbering formats within baseline", numbering.cjkFormats <= (expectations.maxCjkNumberingFormats ?? Number.POSITIVE_INFINITY), {
      actual: numbering.cjkFormats,
      expectedMax: expectations.maxCjkNumberingFormats
    }),
    check("CJK numbering separators within baseline", numbering.cjkSeparators <= (expectations.maxCjkNumberingSeparators ?? Number.POSITIVE_INFINITY), {
      actual: numbering.cjkSeparators,
      expectedMax: expectations.maxCjkNumberingSeparators
    })
  ];
  return {
    caseId: caseConfig.id,
    skipped: false,
    status: summarizeChecks(checks),
    paragraphs: paragraphs.length,
    nonTargetParagraphs: issueParagraphs.length,
    commonEnglishResiduals: commonEnglishResiduals.length,
    knownResidualHits,
    examples: issueParagraphs.slice(0, 8).map((item) => item.text.slice(0, 160)),
    numbering,
    checks
  };
};

const runPdfSmoke = () => {
  const caseConfig = findCase("pdf-detection-tutorial-french-text-layer");
  const pdfDir = realPath("local-data/pdf");
  const pdfFiles = listPdfFiles(pdfDir);
  const sourcePath = firstExisting(resolveLocalCandidates(caseConfig.localPaths.sourceCandidates)) ||
    pdfFiles.find((filePath) => !/^Translated_/i.test(path.basename(filePath))) ||
    null;
  const translatedPath = firstExisting(resolveLocalCandidates(caseConfig.localPaths.translatedCandidates)) ||
    pdfFiles.find((filePath) => /^Translated_/i.test(path.basename(filePath))) ||
    null;
  if (!sourcePath || !translatedPath || !exists(sourcePath) || !exists(translatedPath)) {
    return { caseId: caseConfig.id, skipped: true, status: "skipped", reason: "PDF sample files not found." };
  }
  const source = {
    ...pdfInfo(sourcePath),
    text: pdfTextLength(sourcePath),
    renderBytes: renderPdfFirstPage(sourcePath)
  };
  const translated = {
    ...pdfInfo(translatedPath),
    text: pdfTextLength(translatedPath),
    renderBytes: renderPdfFirstPage(translatedPath)
  };
  const expectations = caseConfig.expectations || {};
  const translatedTextLayerCheck = expectations.translatedLegacyImageOnlyAllowed
    ? check("legacy translated PDF may be image-only", true, {
        actualTextChars: translated.text.chars,
        note: translated.text.chars === 0 ? "legacy image-only artifact tracked" : "translated PDF has extractable text"
      })
    : check("translated PDF has extractable text", translated.text.chars > 0, { actualTextChars: translated.text.chars });
  const checks = [
    check("source PDF text extraction meets baseline", source.text.chars >= (expectations.sourceMinTextChars || 0), {
      actual: source.text.chars,
      expectedMin: expectations.sourceMinTextChars || 0
    }),
    check("source PDF render meets baseline", source.renderBytes >= (expectations.sourceMinRenderBytes || 0), {
      actual: source.renderBytes,
      expectedMin: expectations.sourceMinRenderBytes || 0
    }),
    check("translated PDF render meets baseline", translated.renderBytes >= (expectations.translatedMinRenderBytes || 0), {
      actual: translated.renderBytes,
      expectedMin: expectations.translatedMinRenderBytes || 0
    }),
    translatedTextLayerCheck
  ];
  return {
    caseId: caseConfig.id,
    skipped: false,
    status: summarizeChecks(checks),
    source,
    translated,
    checks
  };
};

const main = async () => {
  const result = {
    schema: "poct.real_document_smoke_result.v1",
    createdAt: new Date().toISOString(),
    manifest: {
      schema: manifest.schema,
      caseCount: manifest.cases.length,
      caseIds: manifest.cases.map((item) => item.id)
    },
    excel: await runExcelSmoke(),
    docx: await runDocxSmoke(),
    pdf: runPdfSmoke()
  };
  console.log(JSON.stringify(result, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
