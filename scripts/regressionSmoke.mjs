import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import * as XLSX from "xlsx";

const repoRoot = path.resolve(import.meta.dirname, "..");

const transpileTsModule = async (sourcePath) => {
  const source = fs.readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      verbatimModuleSyntax: false
    }
  }).outputText;
  const tmpDir = fs.mkdtempSync(path.join(repoRoot, ".tmp-regression-"));
  const outputPath = path.join(tmpDir, `${path.basename(sourcePath, ".ts")}.mjs`);
  fs.writeFileSync(outputPath, output);
  const mod = await import(pathToFileURL(outputPath).href);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return mod;
};

test("Excel parser flattens multiple sheets and export writes each row back to its source sheet", async () => {
  const { parseExcelWorkbook, exportToExcel } = await transpileTsModule(
    path.join(repoRoot, "utils/excel.ts")
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["ID", "Text"],
      [1, "白细胞"],
      [2, "红细胞"]
    ]),
    "Sheet A"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["ID", "Text"],
      [3, "血小板"]
    ]),
    "Sheet B"
  );

  const { records, context } = parseExcelWorkbook(workbook);
  assert.equal(records.length, 3);
  assert.equal(context.sheets.length, 2);
  assert.deepEqual(
    context.sheets.map((sheet) => [sheet.sheetName, sheet.startIndex, sheet.rowCount]),
    [
      ["Sheet A", 0, 2],
      ["Sheet B", 2, 1]
    ]
  );

  const outPath = path.join(os.tmpdir(), `poct-export-${Date.now()}.xlsx`);
  exportToExcel(
    records.map((row) => ({ ...row, Text: `${row.Text} translated` })),
    outPath,
    context,
    { overwriteFormulas: true }
  );
  const exported = XLSX.read(fs.readFileSync(outPath), { type: "buffer" });
  assert.equal(exported.Sheets["Sheet A"].B2.v, "白细胞 translated");
  assert.equal(exported.Sheets["Sheet A"].B3.v, "红细胞 translated");
  assert.equal(exported.Sheets["Sheet B"].B2.v, "血小板 translated");
  fs.rmSync(outPath, { force: true });
});

test("frontend upload copy stays aligned with supported formats", () => {
  const appSource = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf8");
  assert.match(appSource, /accept="\.xlsx,\.docx,\.pdf"/);
  assert.match(appSource, /extension !== 'xlsx' && extension !== 'docx' && extension !== 'pdf'/);
  assert.match(appSource, /Supports Excel \(\.xlsx\), Word \(\.docx\), and text-based PDF documents/);
  assert.doesNotMatch(appSource, /accept="[^"]*\.xls(?:,|")/);
});

test("PDF support is text-first and exports translated content as DOCX", () => {
  const pdfSource = fs.readFileSync(path.join(repoRoot, "utils/pdf.ts"), "utf8");
  const appSource = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf8");
  assert.match(pdfSource, /getDocument\(\{ data \}\)/);
  assert.match(pdfSource, /getTextContent\(\)/);
  assert.match(pdfSource, /getOperatorList\(\)/);
  assert.match(pdfSource, /exportPdfTranslationAsDocx/);
  assert.match(pdfSource, /Packer\.toBlob/);
  assert.match(pdfSource, /ImageRun/);
  assert.match(pdfSource, /已回填 .* 个可提取图片/);
  assert.doesNotMatch(appSource, /disabled=\{!capabilities\.openrouter\}/);
  assert.match(appSource, /PDF 第一阶段导出为 Word 译文/);
  assert.match(appSource, /documentKind === 'docx' \|\| documentKind === 'pdf'/);
  assert.match(appSource, /getTranslationOptions: getDocumentQualityTranslationOptions/);
  assert.match(appSource, /Auto \$\{documentKind\.toUpperCase\(\)\} Quality/);
});

test("DOCX scope warnings are surfaced for unsupported document parts", () => {
  const docxSource = fs.readFileSync(path.join(repoRoot, "utils/docx.ts"), "utf8");
  const appSource = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf8");
  assert.match(docxSource, /coverageWarnings/);
  assert.match(docxSource, /header\\d\*\\.xml/);
  assert.match(docxSource, /footnotes\\.xml/);
  assert.match(appSource, /DOCX scope note/);
});

test("production proxy builds do not inject server-side model keys into the browser bundle", () => {
  const viteSource = fs.readFileSync(path.join(repoRoot, "vite.config.ts"), "utf8");
  assert.match(viteSource, /allowClientKeys = translationMode === 'direct'/);
  assert.doesNotMatch(viteSource, /env\.OPENROUTER_API_KEY\s*\|\|/);
  assert.doesNotMatch(viteSource, /allowClientKeys\s*\?\s*env\.GEMINI_API_KEY/);
  assert.doesNotMatch(viteSource, /allowClientKeys\s*\?\s*env\.DEEPSEEK_API_KEY/);
  assert.match(viteSource, /'process\.env\.OPENROUTER_API_KEY': JSON\.stringify\(''\)/);
});

test("translation memory supports exact reuse and in-file dedupe", async () => {
  const memorySource = fs.readFileSync(path.join(repoRoot, "utils/translationMemory.ts"), "utf8");
  const appSource = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf8");
  const { normalizeMemorySource, buildTranslationMemoryKey } = await transpileTsModule(
    path.join(repoRoot, "utils/translationMemory.ts")
  );

  assert.equal(normalizeMemorySource("  WBC\r\n count\t  "), "WBC\n count");
  assert.equal(
    buildTranslationMemoryKey("WBC count", "Chinese"),
    buildTranslationMemoryKey(" WBC  count ", "Chinese")
  );
  assert.notEqual(
    buildTranslationMemoryKey("WBC count", "Chinese"),
    buildTranslationMemoryKey("WBC count", "English")
  );
  assert.match(memorySource, /indexedDB/);
  assert.match(memorySource, /lookupTranslationMemoryBatch/);
  assert.match(memorySource, /saveTranslationMemoryPairs/);
  assert.match(appSource, /Translation Memory: 复用/);
  assert.match(appSource, /followers\.get\(leader\.memoryKey\)/);
  assert.match(appSource, /Clear TM/);
});

test("Traditional Chinese Taiwan target has UI, prompt, and quality-check coverage", async () => {
  const appSource = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf8");
  const languageSource = fs.readFileSync(path.join(repoRoot, "utils/language.ts"), "utf8");
  const profileSource = fs.readFileSync(path.join(repoRoot, "utils/translationProfiles.ts"), "utf8");
  const modelReviewSource = fs.readFileSync(path.join(repoRoot, "functions/api/model-review.ts"), "utf8");
  const { TARGET_LANGUAGE_OPTIONS, STRING_RESOURCE_TARGET_LANGS, getTargetLanguageLabel, getTargetLocaleInstruction } =
    await transpileTsModule(path.join(repoRoot, "utils/targetLanguage.ts"));

  assert.ok(TARGET_LANGUAGE_OPTIONS.includes("Traditional Chinese (Taiwan)"));
  assert.ok(STRING_RESOURCE_TARGET_LANGS.includes("Traditional Chinese (Taiwan)"));
  assert.equal(
    getTargetLanguageLabel("Traditional Chinese (Taiwan)"),
    "Traditional Chinese (Taiwan) / 繁體中文（台灣）"
  );
  assert.match(getTargetLocaleInstruction("Traditional Chinese (Taiwan)"), /Taiwan/);
  assert.match(getTargetLocaleInstruction("Traditional Chinese (Taiwan)"), /品質/);
  assert.match(getTargetLocaleInstruction("Traditional Chinese (Taiwan)"), /Simplified Chinese/);
  assert.match(appSource, /document\.title = APP_VERSION/);
  assert.match(languageSource, /hasSimplifiedChineseResidue/);
  assert.match(languageSource, /isTraditionalChineseTaiwanTarget\(targetLang\) && hasSimplifiedChineseResidue/);
  assert.match(profileSource, /getTargetLocaleInstruction/);
  assert.match(modelReviewSource, /penalize Simplified Chinese characters/);
});
