import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import * as esbuild from "esbuild";
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

const bundleTsModule = async (sourcePath, options = {}) => {
  const tmpDir = fs.mkdtempSync(path.join(repoRoot, ".tmp-regression-bundle-"));
  const outputPath = path.join(tmpDir, `${path.basename(sourcePath, ".ts")}.mjs`);
  try {
    await esbuild.build({
      entryPoints: [sourcePath],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      outfile: outputPath,
      logLevel: "silent",
      external: options.external || []
    });
    return await import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

const openRouterResponse = (content, status = 200) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content
          }
        }
      ]
    }),
    {
      status,
      headers: { "Content-Type": "application/json" }
    }
  );

const functionContext = (body, env = {}) => ({
  request: new Request("https://poct-translator.local/api/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://poct-translator.local",
      "x-user-email": "dev@example.com"
    },
    body: JSON.stringify(body)
  }),
  env: {
    ALLOW_LOCAL_WITHOUT_ACCESS: "true",
    LOCAL_DEV_EMAIL: "dev@example.com",
    OPENROUTER_API_KEY: "test-openrouter-key",
    ...env
  }
});

const withMockedFetch = async (handler) => {
  const originalFetch = globalThis.fetch;
  try {
    await handler((mock) => {
      globalThis.fetch = mock;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
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
  assert.match(pdfSource, /exportPdfTranslationAsPdf/);
  assert.match(pdfSource, /Packer\.toBlob/);
  assert.match(pdfSource, /jsPDF/);
  assert.match(appSource, /Download Translated PDF/);
  assert.match(appSource, /Download Review DOCX/);
  assert.match(pdfSource, /ImageRun/);
  assert.match(pdfSource, /getPositionedPageSegments/);
  assert.match(pdfSource, /renderTextBlockToPng/);
  assert.match(pdfSource, /drawSelectablePdfText/);
  assert.match(pdfSource, /PDF_TEXT_LAYER_SAFE_REGEX/);
  assert.match(appSource, /PDF download blocked/);
  assert.match(pdfSource, /已回填 .* 个可提取图片/);
  assert.doesNotMatch(appSource, /disabled=\{!capabilities\.openrouter\}/);
  assert.match(appSource, /PDF 可运行质量检查并显示 Retry Missing PDF Segments/);
  assert.match(appSource, /Retry Missing PDF Segments/);
  assert.match(appSource, /documentKind === 'docx' \|\| documentKind === 'pdf'/);
  assert.match(appSource, /getTranslationOptions: getDocumentQualityTranslationOptions/);
  assert.match(appSource, /Auto \$\{documentKind\.toUpperCase\(\)\} Quality/);
});

test("DOCX parser covers body, headers, footers, footnotes, endnotes, and comments", () => {
  const docxSource = fs.readFileSync(path.join(repoRoot, "utils/docx.ts"), "utf8");
  const appSource = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf8");
  assert.match(docxSource, /coverageWarnings/);
  assert.match(docxSource, /formatDocxCoverageSummary/);
  assert.match(docxSource, /numbering\\.xml/);
  assert.match(docxSource, /normalizeDocxNumbering/);
  assert.match(docxSource, /CJK_NUMBER_FORMAT_REGEX/);
  assert.match(docxSource, /header\\d\*\\.xml/);
  assert.match(docxSource, /footer\\d\*\\.xml/);
  assert.match(docxSource, /footnotes\\.xml/);
  assert.match(docxSource, /endnotes\\.xml/);
  assert.match(docxSource, /comments\\.xml/);
  assert.match(docxSource, /parts\.forEach\(\(part\) =>/);
  assert.match(appSource, /DOCX coverage:/);
  assert.match(appSource, /Docx coverage: 导出覆盖/);
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

test("Russian target detection flags mixed English table-of-contents labels", async () => {
  const { isLikelyTargetLanguage, detectUntranslatedCells } = await bundleTsModule(
    path.join(repoRoot, "utils/language.ts")
  );

  assert.equal(isLikelyTargetLanguage("Описание продукта", "Russian"), true);
  assert.equal(isLikelyTargetLanguage("Home: Главная страница", "Russian"), false);
  assert.equal(isLikelyTargetLanguage("Orders: Заказы на исследование", "Russian"), false);
  assert.equal(isLikelyTargetLanguage("Reports: Отчеты об исследовании", "Russian"), false);
  assert.equal(isLikelyTargetLanguage("AI analysis: Анализ отчета AI", "Russian"), false);
  assert.equal(isLikelyTargetLanguage("OpenDx: руководство пользователя", "Russian"), true);
  assert.equal(isLikelyTargetLanguage("POCT QC: контроль качества", "Russian"), true);

  const issues = detectUntranslatedCells(
    [
      { content: "Описание продукта" },
      { content: "Home: Главная страница" },
      { content: "POCT QC: контроль качества" }
    ],
    "Russian"
  );
  assert.deepEqual(
    issues.map((issue) => issue.value),
    ["Home: Главная страница"]
  );
});

test("API translate function accepts proxy payload and normalizes OpenRouter records", async () => {
  const { onRequestPost } = await bundleTsModule(path.join(repoRoot, "functions/api/translate.ts"));
  const calls = [];

  await withMockedFetch(async (setFetch) => {
    setFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      return openRouterResponse(
        JSON.stringify([
          {
            id: "seg-1",
            content: "Translated IFU sentence."
          }
        ])
      );
    });

    const response = await onRequestPost(
      functionContext({
        records: [{ id: "seg-1", content: "中文说明" }],
        targetLang: "English",
        engine: "openrouter",
        model: "google/gemini-3-flash-preview",
        profile: "docx-manual"
      })
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.engine, "openrouter");
    assert.equal(payload.model, "google/gemini-3-flash-preview");
    assert.deepEqual(payload.records, [{ id: "seg-1", content: "Translated IFU sentence." }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, "google/gemini-3-flash-preview");
    assert.match(calls[0].messages[0].content, /IFU|operator manual/i);
  });
});

test("API review-samples function parses anonymous review JSON without network", async () => {
  const { onRequestPost } = await bundleTsModule(path.join(repoRoot, "functions/api/review-samples.ts"));

  await withMockedFetch(async (setFetch) => {
    setFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      assert.equal(body.model, "judge-model");
      return openRouterResponse(
        JSON.stringify({
          reviews: [
            {
              id: "sample-1",
              verdict: "warning",
              risk: "medium",
              issueTypes: ["terminology"],
              comment: "术语需人工确认",
              suggestion: "Use the corrected term."
            }
          ]
        })
      );
    });

    const response = await onRequestPost(
      functionContext({
        samples: [
          {
            id: "sample-1",
            location: "row 1",
            source: "白细胞升高",
            target: "White blood cells are high"
          }
        ],
        targetLang: "English",
        model: "judge-model"
      })
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.model, "judge-model");
    assert.equal(payload.reviews[0].verdict, "warning");
    assert.equal(payload.reviews[0].risk, "medium");
    assert.deepEqual(payload.reviews[0].issueTypes, ["terminology"]);
  });
});

test("API model-review function translates candidates and ranks anonymous judge scores", async () => {
  const { onRequestPost } = await bundleTsModule(path.join(repoRoot, "functions/api/model-review.ts"));
  const seenModels = [];

  await withMockedFetch(async (setFetch) => {
    setFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      seenModels.push(body.model);
      if (body.model === "judge-a") {
        return openRouterResponse(
          JSON.stringify({
            scores: [
              {
                alias: "Candidate A",
                accuracy: 9,
                fluency: 8,
                manualStyle: 9,
                terminology: 8,
                formatSafety: 10,
                avoidLiteral: 8,
                avoidYou: 9,
                overall: 8.7,
                notes: "表达自然"
              },
              {
                alias: "Candidate B",
                accuracy: 7,
                fluency: 7,
                manualStyle: 7,
                terminology: 7,
                formatSafety: 10,
                avoidLiteral: 6,
                avoidYou: 8,
                overall: 7.2,
                notes: "略直译"
              }
            ]
          })
        );
      }
      return openRouterResponse(
        JSON.stringify([
          {
            id: "sample-1",
            content: `${body.model} translated output`
          }
        ])
      );
    });

    const response = await onRequestPost(
      functionContext({
        samples: [
          {
            id: "sample-1",
            location: "DOCX segment 1",
            sourceText: "请勿触摸探头",
            contextBefore: ["安全说明"],
            contextAfter: ["继续操作前关闭电源"]
          }
        ],
        targetLang: "English",
        translationModels: ["model-a", "model-b"],
        judgeModels: ["judge-a"],
        reviewStyle: "ifu-manual",
        profile: "docx-manual"
      })
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(seenModels.sort(), ["judge-a", "model-a", "model-b"].sort());
    assert.equal(payload.candidates.length, 2);
    assert.equal(payload.judges.length, 1);
    assert.equal(payload.ranking[0].alias, "Candidate A");
    assert.equal(payload.ranking[0].model, "model-a");
    assert.ok(payload.ranking[0].overall > payload.ranking[1].overall);
  });
});

test("TranslationHub retry flow splits recoverable proxy batch failures and preserves order", async () => {
  const { TranslationHub } = await bundleTsModule(path.join(repoRoot, "services/translationHub.ts"), {
    external: ["@google/genai"]
  });
  const originalMode = process.env.VITE_TRANSLATION_MODE;
  const calls = [];

  try {
    process.env.VITE_TRANSLATION_MODE = "proxy";
    await withMockedFetch(async (setFetch) => {
      setFetch(async (_url, init) => {
        const body = JSON.parse(String(init.body));
        calls.push(body.records.map((record) => record.content));
        if (body.records.length > 1) {
          return new Response(JSON.stringify({ engine: "openrouter", records: [{ content: "only one" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response(
          JSON.stringify({
            engine: "openrouter",
            records: body.records.map((record) => ({
              ...record,
              content: `${record.content} translated`
            }))
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      });

      const hub = new TranslationHub();
      const result = await hub.translateBatch({
        records: [{ content: "A" }, { content: "B" }],
        targetLang: "English",
        options: { model: "openrouter" }
      });
      assert.deepEqual(calls, [["A", "B"], ["A"], ["B"]]);
      assert.deepEqual(result, [{ content: "A translated" }, { content: "B translated" }]);
    });
  } finally {
    if (originalMode === undefined) {
      delete process.env.VITE_TRANSLATION_MODE;
    } else {
      process.env.VITE_TRANSLATION_MODE = originalMode;
    }
  }
});
