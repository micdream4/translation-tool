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

const realPath = (...parts) => path.join(repoRoot, ...parts);

const exists = (filePath) => fs.existsSync(filePath);

const firstExisting = (candidates) => candidates.find((candidate) => candidate && exists(candidate)) || null;

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
      external: ["xlsx", "jszip", "docx", "pdfjs-dist", "jspdf"],
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
  const sourcePath = realPath("local-data/excel/source/BA512-AI版-兽-白细胞全-20250107.xlsx");
  const translatedPath = realPath("local-data/excel/translated/Translated_English_BA512-AI版-兽-白细胞全-20250107 (7).xlsx");
  if (!sourcePath || !translatedPath || !exists(sourcePath) || !exists(translatedPath)) {
    return { skipped: true, reason: "Excel sample files not found." };
  }
  const { parseExcelWorkbook, exportToExcel } = await bundleTsModule(realPath("utils/excel.ts"));
  const { runQualityChecks } = await bundleTsModule(realPath("utils/quality.ts"));
  const source = parseExcelWorkbook(XLSX.readFile(sourcePath, { cellStyles: true }));
  const translated = parseExcelWorkbook(XLSX.readFile(translatedPath, { cellStyles: true }));
  const report = runQualityChecks(source.records, translated.records);
  const outPath = path.join(os.tmpdir(), `poct-real-excel-${Date.now()}.xlsx`);
  const exportStats = exportToExcel(translated.records, outPath, source.context, {
    overwriteFormulas: true
  });
  const exported = XLSX.readFile(outPath, { cellStyles: true });
  const exportedSheets = exported.SheetNames.length;
  fs.rmSync(outPath, { force: true });
  return {
    skipped: false,
    sourceRows: source.records.length,
    translatedRows: translated.records.length,
    sheets: source.context.sheets.length,
    exportedSheets,
    quality: report.totals,
    exportStats
  };
};

const runDocxSmoke = async () => {
  const russianPath = realPath(
    "local-data/docx/russia/Translated_Russian_DRS-BA532-04 Y6.06.08.003.A1 BA532兽用多功能分析仪 说明书A01-20260403使用环境增加了海拔要求(2).docx"
  );
  if (!exists(russianPath)) {
    return { skipped: true, reason: "DOCX Russian sample file not found." };
  }
  const { isLikelyTargetLanguage } = await bundleTsModule(realPath("utils/language.ts"));
  const paragraphs = await extractDocxParagraphs(russianPath);
  const issueParagraphs = paragraphs.filter((item) => !isLikelyTargetLanguage(item.text, "Russian"));
  const commonEnglishResiduals = paragraphs.filter((item) =>
    /\b(?:List|Building|Street|District|City|Province|feces|service|reference|establish|uncertain|White Blood Cell Count)\b/i.test(item.text)
  );
  const numbering = await inspectDocxNumbering(russianPath);
  return {
    skipped: false,
    paragraphs: paragraphs.length,
    nonTargetParagraphs: issueParagraphs.length,
    commonEnglishResiduals: commonEnglishResiduals.length,
    examples: issueParagraphs.slice(0, 8).map((item) => item.text.slice(0, 160)),
    numbering
  };
};

const runPdfSmoke = () => {
  const pdfDir = realPath("local-data/pdf");
  const pdfFiles = listPdfFiles(pdfDir);
  const sourcePath = firstExisting([
    realPath("local-data/pdf/检测教程-202英文 (1).pdf"),
    realPath("local-data/pdf/检测教程-202英文.pdf")
  ]) || pdfFiles.find((filePath) => !/^Translated_/i.test(path.basename(filePath))) || null;
  const translatedPath = firstExisting([
    realPath("local-data/pdf/Translated_French_检测教程-202英文.pdf")
  ]) || pdfFiles.find((filePath) => /^Translated_/i.test(path.basename(filePath))) || null;
  if (!exists(sourcePath) || !exists(translatedPath)) {
    return { skipped: true, reason: "PDF sample files not found." };
  }
  return {
    skipped: false,
    source: {
      ...pdfInfo(sourcePath),
      text: pdfTextLength(sourcePath),
      renderBytes: renderPdfFirstPage(sourcePath)
    },
    translated: {
      ...pdfInfo(translatedPath),
      text: pdfTextLength(translatedPath),
      renderBytes: renderPdfFirstPage(translatedPath)
    }
  };
};

const main = async () => {
  const result = {
    createdAt: new Date().toISOString(),
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
