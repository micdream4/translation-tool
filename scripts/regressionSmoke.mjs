import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as esbuild from "esbuild";
import ts from "typescript";
import * as XLSX from "xlsx";

const repoRoot = path.resolve(import.meta.dirname, "..");

const collectExecutableCandidates = (command) => {
  const pathCandidates = String(process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, command));
  const homebrewCandidates = [
    `/opt/homebrew/bin/${command}`,
    `/usr/local/bin/${command}`,
    `/usr/bin/${command}`
  ];
  try {
    const popplerRoot = "/opt/homebrew/Cellar/poppler";
    fs.readdirSync(popplerRoot)
      .sort()
      .reverse()
      .forEach((version) => {
        homebrewCandidates.push(path.join(popplerRoot, version, "bin", command));
      });
  } catch {
    // Poppler is optional for the CJK text-layer regression.
  }
  return [...pathCandidates, ...homebrewCandidates];
};

const findExecutable = (command) =>
  collectExecutableCandidates(command).find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) || null;

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

test("frontend auth state is isolated in useAuth hook", () => {
  const appSource = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf8");
  const authHookSource = fs.readFileSync(path.join(repoRoot, "hooks/useAuth.ts"), "utf8");
  const authFunctionSource = fs.readFileSync(path.join(repoRoot, "functions/_shared/auth.ts"), "utf8");
  const llmProviderSource = fs.readFileSync(path.join(repoRoot, "functions/_shared/llmProviders.ts"), "utf8");
  const meFunctionSource = fs.readFileSync(path.join(repoRoot, "functions/api/me.ts"), "utf8");
  const wranglerSource = fs.readFileSync(path.join(repoRoot, "wrangler.toml"), "utf8");
  assert.match(appSource, /import \{ useAuth \} from '\.\/hooks\/useAuth'/);
  assert.match(appSource, /const authState = useAuth\(\)/);
  assert.match(appSource, /authState\.translationCapabilities/);
  assert.doesNotMatch(appSource, /fetch\('\/api\/me'/);
  assert.match(authHookSource, /fetch\('\/api\/me', \{ credentials: 'same-origin' \}\)/);
  assert.match(authHookSource, /translationCapabilities/);
  assert.match(authHookSource, /normalizeCapabilities/);
  assert.match(authHookSource, /status: 'authenticated'/);
  assert.match(authHookSource, /status: 'blocked'/);
  assert.match(authHookSource, /status: 'anonymous'/);
  assert.match(wranglerSource, /REQUIRE_CF_ACCESS_EMAIL = "true"/);
  assert.match(wranglerSource, /CLOUDFLARE_AI_PRIMARY_MODELS = "google\/gemini-3-flash"/);
  assert.match(wranglerSource, /CLOUDFLARE_AI_FALLBACK_MODELS = "openai\/gpt-5\.4,anthropic\/claude-sonnet-4\.6"/);
  assert.match(wranglerSource, /DEEPSEEK_MODELS = "deepseek-v4-flash,deepseek-v4-pro"/);
  assert.match(wranglerSource, /DEEPSEEK_REQUEST_TIMEOUT_MS = "90000"/);
  assert.match(wranglerSource, /DEEPSEEK_PRO_REQUEST_TIMEOUT_MS = "120000"/);
  assert.match(wranglerSource, /DEEPSEEK_PRO_MAX_OUTPUT_TOKENS = "24576"/);
  assert.match(wranglerSource, /MODEL_REVIEW_TRANSLATION_CONCURRENCY = "2"/);
  assert.match(wranglerSource, /MODEL_REVIEW_JUDGE_CONCURRENCY = "1"/);
  assert.match(
    fs.readFileSync(path.join(repoRoot, "functions/api/translate.ts"), "utf8"),
    /DEFAULT_DEEPSEEK_REQUEST_TIMEOUT_MS = 90000[\s\S]*DEFAULT_DEEPSEEK_PRO_REQUEST_TIMEOUT_MS = 120000[\s\S]*parseOpenRouterTimeoutMs[\s\S]*Math\.min\(55000[\s\S]*parseDeepSeekTimeoutMs[\s\S]*Math\.min\(180000/
  );
  assert.match(wranglerSource, /CLOUDFLARE_REVIEW_TRANSLATION_MODELS = "cloudflare-ai:google\/gemini-3-flash,deepseek:deepseek-v4-flash,deepseek:deepseek-v4-pro,cloudflare-ai:openai\/gpt-5\.4,cloudflare-ai:anthropic\/claude-sonnet-4\.6"/);
  assert.match(wranglerSource, /CLOUDFLARE_REVIEW_JUDGE_MODELS = "cloudflare-ai:openai\/gpt-5\.4,cloudflare-ai:anthropic\/claude-sonnet-4\.6,deepseek:deepseek-v4-pro"/);
  assert.doesNotMatch(wranglerSource, /ALLOWED_USER_EMAILS|ALLOWED_EMAILS/);
  assert.match(meFunctionSource, /accessControlledBy: "cloudflare-zero-trust"/);
  assert.match(meFunctionSource, /getTranslationCapabilities/);
  assert.match(llmProviderSource, /DEEPSEEK_API_KEY/);
  assert.doesNotMatch(meFunctionSource, /whitelistEnabled|allowedEmails/);
  assert.doesNotMatch(authFunctionSource, /parseAllowedEmails|ALLOWED_USER_EMAILS|ALLOWED_EMAILS/);
  assert.doesNotMatch(authFunctionSource, /Forbidden: user not in whitelist/);
});

test("API me exposes server-side translation capabilities without leaking keys", async () => {
  const { onRequestGet } = await bundleTsModule(path.join(repoRoot, "functions/api/me.ts"));

  const response = await onRequestGet({
    request: new Request("https://poct-translator.local/api/me", {
      headers: {
        "x-user-email": "dev@example.com"
      }
    }),
    env: {
      ALLOW_LOCAL_WITHOUT_ACCESS: "true",
      LOCAL_DEV_EMAIL: "dev@example.com",
      OPENROUTER_API_KEY: "test-openrouter-key",
      OPENROUTER_MODELS: "fallback-model",
      DEEPSEEK_API_KEY: "test-deepseek-key",
      AI: {
        run: async () => ({})
      }
    }
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.authenticated, true);
  assert.deepEqual(payload.translationCapabilities, {
    cloudflareAi: true,
    deepseek: true,
    openrouter: true,
    gemini: false
  });
  assert.doesNotMatch(JSON.stringify(payload), /test-deepseek-key|test-openrouter-key/);
});

test("GitHub issue template captures debug packages with available labels", () => {
  const templateSource = fs.readFileSync(
    path.join(repoRoot, ".github/ISSUE_TEMPLATE/translation-bug.yml"),
    "utf8"
  );
  assert.match(templateSource, /name: 翻译结果问题/);
  assert.match(templateSource, /- bug/);
  assert.doesNotMatch(templateSource, /translation-bug/);
  assert.doesNotMatch(templateSource, /needs-triage/);
  assert.match(templateSource, /id: debug-package/);
  assert.match(templateSource, /Debug Package/);
});

test("PDF support is text-first and exports translated content as DOCX", async () => {
  const pdfSource = fs.readFileSync(path.join(repoRoot, "utils/pdf.ts"), "utf8");
  const pdfWorkflowSource = fs.readFileSync(path.join(repoRoot, "workflows/pdfTranslationWorkflow.ts"), "utf8");
  const pdfTextLayerSource = fs.readFileSync(path.join(repoRoot, "utils/pdfTextLayer.ts"), "utf8");
  const appSource = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf8");
  const { canDrawSelectablePdfText, normalizePdfTextLayerText } = await bundleTsModule(path.join(repoRoot, "utils/pdfTextLayer.ts"));
  assert.match(pdfSource, /getDocument\(\{ data \}\)/);
  assert.match(pdfSource, /getTextContent\(\)/);
  assert.match(pdfSource, /getOperatorList\(\)/);
  assert.match(pdfSource, /exportPdfTranslationAsDocx/);
  assert.match(pdfSource, /exportPdfTranslationAsPdf/);
  assert.match(pdfSource, /Packer\.toBlob/);
  assert.match(pdfSource, /PDFDocument\.create/);
  assert.match(pdfSource, /registerFontkit/);
  assert.match(pdfSource, /\/fonts\/NotoSansHans-Regular\.otf/);
  assert.match(pdfSource, /getMultilingualFont/);
  assert.match(pdfSource, /standardText \? latinFont : await getMultilingualFont\(\)/);
  assert.doesNotMatch(pdfSource, /from 'jspdf'/);
  assert.match(appSource, /Download Translated PDF/);
  assert.match(appSource, /Download Review DOCX/);
  assert.match(pdfSource, /ImageRun/);
  assert.match(pdfSource, /getPositionedPageSegments/);
  assert.match(pdfSource, /drawEmbeddedPdfText/);
  assert.match(pdfSource, /getStandardPdfTextLayerText/);
  assert.match(pdfSource, /backgroundImage/);
  assert.match(pdfSource, /getPageBackgroundImage/);
  assert.match(pdfSource, /attachSegmentBackgroundColors/);
  assert.match(pdfSource, /pushToken/);
  assert.match(pdfTextLayerSource, /PDF_TEXT_LAYER_SAFE_REGEX/);
  assert.match(pdfTextLayerSource, /normalizePdfTextLayerText/);
  assert.match(pdfSource, /from '.\/pdfTextLayer'/);
  assert.match(pdfSource, /getPdfTextLayerStats/);
  assert.match(appSource, /PDF text layer:/);
  assert.equal(
    normalizePdfTextLayerText("L\u2019\u00E9chantillon \u0153st pr\u00EAt \u2013 2\u202F\u00B5l"),
    "L'\u00E9chantillon oest pr\u00EAt - 2 ul"
  );
  assert.equal(canDrawSelectablePdfText("L\u2019\u00E9chantillon est pr\u00EAt \u2013 2\u202F\u00B5l"), true);
  assert.equal(canDrawSelectablePdfText("Подготовка образца"), false);
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const cjkFont = await pdfDoc.embedFont(
    fs.readFileSync(path.join(repoRoot, "node_modules/@embedpdf/fonts-sc/fonts/NotoSansHans-Regular.otf")),
    { subset: true }
  );
  const pdfPage = pdfDoc.addPage([500, 200]);
  const cjkText = "打造 AI 原生初创企业 Русский текст";
  pdfPage.drawText(cjkText, { x: 40, y: 120, size: 14, font: cjkFont, color: rgb(0, 0, 0) });
  const pdfOut = path.join(os.tmpdir(), `poct-cjk-text-layer-${Date.now()}.pdf`);
  fs.writeFileSync(pdfOut, await pdfDoc.save());
  const pdfToText = findExecutable("pdftotext");
  if (pdfToText) {
    const extractedText = execFileSync(pdfToText, [pdfOut, "-"], { encoding: "utf8" });
    assert.match(extractedText, /打造 AI 原生初创企业/);
    assert.match(extractedText, /Русский текст/);
  } else {
    console.warn("# pdftotext not found; skipped external text extraction assertion.");
  }
  fs.rmSync(pdfOut, { force: true });
  assert.match(appSource, /PDF download blocked/);
  assert.match(pdfSource, /已回填 .* 个可提取图片/);
  assert.doesNotMatch(appSource, /disabled=\{!capabilities\.openrouter\}/);
  assert.match(appSource, /PDF 可运行质量检查并显示 Retry Missing PDF Segments/);
  assert.match(appSource, /Retry Missing PDF Segments/);
  assert.match(appSource, /documentKind === 'docx' \|\| documentKind === 'pdf'/);
  assert.match(appSource, /getTranslationOptions: getDocumentQualityTranslationOptions/);
  assert.match(appSource, /applyLatestModelCooldowns: applyLatestOpenRouterModelCooldowns/);
  assert.match(appSource, /Auto \$\{documentKind\.toUpperCase\(\)\} Quality/);
  assert.match(appSource, /activeDocumentQualityOpenRouterModels/);
  assert.match(appSource, /buildAdaptiveTextBatches/);
  assert.match(appSource, /const DOCX_BATCH_SIZE = 20/);
  assert.match(appSource, /const DOCX_BATCH_CHAR_LIMIT = 12000/);
  assert.match(appSource, /const DEEPSEEK_PRO_DOCX_BATCH_SIZE = 8/);
  assert.match(appSource, /const DEEPSEEK_PRO_DOCX_BATCH_CHAR_LIMIT = 6000/);
  assert.match(appSource, /getDocumentBatchPolicy/);
  assert.match(pdfWorkflowSource, /applyLatestModelCooldowns\?\.\(`PDF Batch/);
  assert.match(pdfWorkflowSource, /batchCharLimit/);
});

test("adaptive document batching respects item and character limits", async () => {
  const {
    buildAdaptiveTextBatches,
    sumBatchTextChars,
    formatElapsedSeconds
  } = await bundleTsModule(path.join(repoRoot, "utils/translationBatching.ts"));
  const items = [
    { text: "short" },
    { text: "medium text" },
    { text: "x".repeat(12) },
    { text: "tail" }
  ];

  const batches = buildAdaptiveTextBatches({
    items,
    getText: (item) => item.text,
    maxItems: 3,
    maxChars: 20
  });

  assert.deepEqual(
    batches.map((batch) => batch.map((item) => item.text.length)),
    [[5, 11], [12, 4]]
  );
  assert.equal(sumBatchTextChars(batches[0], (item) => item.text), 16);
  assert.equal(formatElapsedSeconds(1234), "1.2s");
});

test("real document smoke uses a local-only regression manifest", () => {
  const manifestPath = path.join(repoRoot, "fixtures/real-document-regression.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const smokeSource = fs.readFileSync(path.join(repoRoot, "scripts/realDocumentSmoke.mjs"), "utf8");
  const gitignoreSource = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");

  assert.equal(manifest.schema, "poct.real_document_regression.v1");
  assert.deepEqual(
    manifest.cases.map((item) => item.documentKind).sort(),
    ["docx", "excel", "pdf"]
  );
  assert.ok(manifest.cases.every((item) => item.id && item.description && item.expectations));
  assert.ok(
    manifest.cases.some((item) =>
      JSON.stringify(item).includes("local-data/docx/russia/")
    )
  );
  assert.match(smokeSource, /real-document-regression\.json/);
  assert.match(smokeSource, /poct\.real_document_regression\.v1/);
  assert.match(smokeSource, /caseId: caseConfig\.id/);
  assert.match(smokeSource, /knownResidualHits/);
  assert.match(smokeSource, /current translated PDF has extractable text/);
  assert.match(smokeSource, /translatedPath: path\.relative\(repoRoot, translatedPath\)/);
  assert.match(gitignoreSource, /^local-data\/$/m);
});

test("local issue capture workflow prepares ignored self-iteration workspace", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const workflowDoc = fs.readFileSync(path.join(repoRoot, "docs/local-issue-capture-workflow.md"), "utf8");
  const prepareScript = fs.readFileSync(path.join(repoRoot, "scripts/prepareLocalIssueWorkspace.mjs"), "utf8");
  const gitignoreSource = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");

  assert.equal(packageJson.scripts["issue:prepare"], "node scripts/prepareLocalIssueWorkspace.mjs");
  assert.match(workflowDoc, /当前阶段先不做完整多 Agent 闭环/);
  assert.match(workflowDoc, /local-data\/inbox\//);
  assert.match(workflowDoc, /local-data\/issues\//);
  assert.match(workflowDoc, /Debug Package/);
  assert.match(workflowDoc, /Regression JSONL/);
  assert.match(workflowDoc, /Issue Draft 只是 Markdown 草稿，不会自动上传/);
  assert.match(workflowDoc, /npm run test:quality-gate/);
  assert.match(prepareScript, /poct\.local_issue_workspace\.v1/);
  assert.match(prepareScript, /local-data 使用规则/);
  assert.match(prepareScript, /issues\/2026-05-16-docx-russian-list-residual/);
  assert.match(prepareScript, /不要把 .*local-data\/.* 里的真实文件提交到 git/);
  assert.match(prepareScript, /debug-packages/);
  assert.match(prepareScript, /regression-jsonl/);
  assert.match(gitignoreSource, /^local-data\/$/m);
});

test("DOCX parser covers body, headers, footers, footnotes, endnotes, and comments", async () => {
  const docxSource = fs.readFileSync(path.join(repoRoot, "utils/docx.ts"), "utf8");
  const appSource = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf8");
  const { setDocxSegmentText, getDocxSegmentText } = await bundleTsModule(
    path.join(repoRoot, "utils/docx.ts")
  );
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
  assert.doesNotMatch(docxSource, /segment\.original\s*=\s*text/);

  const makeTextNode = (text) => ({
    textContent: text,
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    }
  });
  const fragmentedNodes = [makeTextNode("S"), makeTextNode("tatement")];
  const fragmentedSegment = {
    id: "docx-segment-test",
    original: "Statement",
    nodes: fragmentedNodes,
    partPath: "word/document.xml",
    partLabel: "正文"
  };
  setDocxSegmentText(fragmentedSegment, "Declaración");
  assert.equal(getDocxSegmentText(fragmentedSegment), "Declaración");
  assert.deepEqual(fragmentedNodes.map((node) => node.textContent), ["Declaración", ""]);

  const boundaryNodes = [makeTextNode("Ehome"), makeTextNode(" Health Technology Co., Ltd.")];
  const boundarySegment = {
    id: "docx-segment-test-2",
    original: "Ehome Health Technology Co., Ltd.",
    nodes: boundaryNodes,
    partPath: "word/document.xml",
    partLabel: "正文"
  };
  setDocxSegmentText(boundarySegment, "Ehome Health Technology Co., Ltd. se reserva el derecho.");
  assert.equal(getDocxSegmentText(boundarySegment), "Ehome Health Technology Co., Ltd. se reserva el derecho.");
  assert.equal(boundaryNodes.every((node) => typeof node.textContent === "string"), true);
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
  assert.match(appSource, /translationMemoryEnabled/);
  assert.match(appSource, /Use Translation Memory/);
  assert.match(appSource, /不会复用，也不会写入新记忆/);
});

test("quality issue cases can be saved and exported from quality findings", async () => {
  const appSource = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf8");
  const qualityPanelSource = fs.readFileSync(path.join(repoRoot, "components/QualityReportPanel.tsx"), "utf8");
  const qualityHookSource = fs.readFileSync(path.join(repoRoot, "hooks/useQualityWorkflow.ts"), "utf8");
  const issueCaseSource = fs.readFileSync(path.join(repoRoot, "utils/issueCases.ts"), "utf8");
  const issueAssetsSource = fs.readFileSync(path.join(repoRoot, "utils/issueAssets.ts"), "utf8");
  const qualityReportSource = fs.readFileSync(path.join(repoRoot, "utils/qualityReport.ts"), "utf8");
  const debugPackageSource = fs.readFileSync(path.join(repoRoot, "utils/debugPackage.ts"), "utf8");
  const regressionAssetsSource = fs.readFileSync(path.join(repoRoot, "utils/regressionAssets.ts"), "utf8");
  const packageSource = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");
  const { buildTranslationIssueCase, serializeTranslationIssueCasesJsonl } = await transpileTsModule(
    path.join(repoRoot, "utils/issueCases.ts")
  );
  const { buildQualityFindings, buildQualityReportText, mapQualityFindingToIssueType } = await transpileTsModule(
    path.join(repoRoot, "utils/qualityReport.ts")
  );
  const { buildIssueAssetPackage, buildQaRuleCandidatesFromIssueCases, buildTerminologyCandidatesFromIssueCases, buildTranslationMemoryPairsFromIssueCases } = await transpileTsModule(
    path.join(repoRoot, "utils/issueAssets.ts")
  );
  const { serializeDebugPackage, serializeGitHubIssueMarkdown } = await transpileTsModule(path.join(repoRoot, "utils/debugPackage.ts"));
  const {
    buildRegressionCasesFromDebugPackage,
    buildRegressionCasesFromIssueCases,
    parseRegressionCasesJsonl,
    runRegressionCases,
    serializeRegressionCasesJsonl
  } = await bundleTsModule(path.join(repoRoot, "utils/regressionAssets.ts"));

  const issueCase = buildTranslationIssueCase(
    {
      appVersion: "0.0.0-test",
      documentKind: "docx",
      targetLang: "Russian",
      sourceText: "5.1 List of control samples",
      badTranslation: "5.1 List контрольных образцов",
      correctedTranslation: "5.1 Список контрольных образцов",
      issueType: "non-target-residual",
      locationLabel: "DOCX Segment 5",
      model: "test-model",
      promptProfile: "docx-manual"
    },
    new Date("2026-01-01T00:00:00.000Z")
  );

  assert.equal(issueCase.status, "new");
  assert.equal(issueCase.sourceHash, buildTranslationIssueCase({
    appVersion: "0.0.0-test",
    documentKind: "docx",
    targetLang: "Russian",
    sourceText: "5.1 List of control samples",
    badTranslation: "",
    correctedTranslation: "",
    issueType: "non-target-residual",
    locationLabel: "DOCX Segment 5"
  }).sourceHash);
  assert.match(serializeTranslationIssueCasesJsonl([issueCase]), /Список контрольных образцов/);
  assert.match(issueCaseSource, /poct\.translation_issue_cases\.v1/);
  assert.match(appSource, /<QualityReportPanel/);
  assert.match(qualityPanelSource, /Save & Apply/);
  assert.match(qualityPanelSource, /findingSeverityFilter/);
  assert.match(qualityPanelSource, /\['all', 'high', 'medium', 'low'\]/);
  assert.match(qualityPanelSource, /Export Cases/);
  assert.match(qualityPanelSource, /Promote TM/);
  assert.match(qualityPanelSource, /Asset JSON/);
  assert.match(qualityPanelSource, /Debug Package/);
  assert.match(qualityPanelSource, /Issue Draft/);
  assert.match(qualityPanelSource, /Regression JSONL/);
  assert.match(qualityPanelSource, /Quality Loop/);
  assert.match(appSource, /useQualityWorkflow/);
  assert.match(appSource, /exportDebugPackage/);
  assert.match(appSource, /exportIssueDraft/);
  assert.match(appSource, /exportRegressionCases/);
  assert.match(qualityHookSource, /saveTranslationIssueCase/);
  assert.match(qualityHookSource, /setDocxSegmentText/);
  assert.match(qualityHookSource, /setPdfSegmentText/);
  assert.match(qualityHookSource, /applyFindingCorrectionToDocument/);
  assert.match(qualityHookSource, /rememberTranslationPairs/);
  assert.match(qualityHookSource, /serializeDebugPackage/);
  assert.match(qualityHookSource, /serializeGitHubIssueMarkdown/);
  assert.match(qualityHookSource, /buildRegressionCasesFromIssueCases/);
  assert.match(qualityHookSource, /buildIssueAssetPackage/);
  assert.match(qualityHookSource, /promoteIssueCasesToTranslationMemory/);
  assert.match(qualityHookSource, /buildQualityFindings/);
  assert.match(qualityHookSource, /buildQualityReportText/);
  assert.match(qualityHookSource, /SampleReviewAuditService/);
  assert.match(qualityHookSource, /const runQualityCheck/);
  assert.match(qualityHookSource, /runQualityChecksOnUnits/);
  assert.match(qualityHookSource, /runQualityChecks\(data, target, \{ targetLang \}\)/);
  assert.doesNotMatch(appSource, /const runQualityCheck =/);
  assert.match(appSource, /segmentsToQualityUnits/);
  assert.match(qualityReportSource, /mapQualityFindingToIssueType/);
  assert.match(issueAssetsSource, /poct\.translation_issue_assets\.v1/);
  assert.match(debugPackageSource, /poct\.translation_debug_package\.v1/);
  assert.match(regressionAssetsSource, /poct\.translation_regression_case\.v1/);
  assert.match(packageSource, /test:issue-regression/);
  assert.match(packageSource, /test:quality-gate/);

  const qualityReport = {
    totals: {
      cellsScanned: 3,
      rowsScanned: 2,
      chineseCells: 0,
      chineseRows: 0,
      placeholderCells: 1,
      placeholderRows: 1,
      idMismatches: 0,
      idMismatchRows: 0,
      spacingIssues: 1,
      spacingRows: 1,
      spacingHigh: 0,
      spacingMedium: 1,
      spacingLow: 0,
      emptyTranslations: 0,
      emptyTranslationRows: 0,
      structureMismatches: 0,
      structureMismatchRows: 0,
      nonTargetCells: 0,
      nonTargetRows: 0
    },
    issues: {
      chinese: [],
      placeholders: [{ rowIndex: 1, columnKey: "content", locationLabel: "DOCX segment 2", value: "__TKN_1__", original: "%s", type: "placeholder" }],
      idMismatch: [],
      spacing: [{ rowIndex: 0, columnKey: "content", locationLabel: "DOCX segment 1", value: "2 - 8 °C", original: "2-8°C", type: "spacing", severity: "medium" }],
      emptyTranslations: [],
      structureMismatches: [],
      nonTargetLanguage: []
    }
  };
  const findings = buildQualityFindings({
    qualityReport,
    nonTargetDetails: [{ rowIndex: 0, columnKey: "content", locationLabel: "DOCX segment 1", value: "List контрольных образцов" }],
    qualityRows: {
      sourceRows: [{ content: "List of control samples" }, { content: "%s" }],
      targetRows: [{ content: "List контрольных образцов" }, { content: "__TKN_1__" }]
    },
    formatLocationLabel: (rowIndex, columnKey) => `R${rowIndex + 1}/${columnKey}`
  });

  assert.deepEqual(
    findings.map((finding) => finding.category),
    ["nonTarget", "spacing", "placeholder"]
  );
  const sourceTargetFindings = buildQualityFindings({
    qualityReport: {
      totals: qualityReport.totals,
      issues: {
        chinese: [],
        placeholders: [],
        idMismatch: [],
        spacing: [
          {
            rowIndex: 0,
            columnKey: "content",
            locationLabel: "DOCX segment 1",
            value: "На данный анализатор предоставляется стандартная гарантия сроком 1-year.",
            original: "На данный анализатор предоставляется стандартная гарантия сроком 1-year.",
            type: "spacing",
            severity: "medium"
          }
        ],
        emptyTranslations: [],
        structureMismatches: [],
        nonTargetLanguage: [
          {
            rowIndex: 0,
            columnKey: "content",
            locationLabel: "DOCX segment 1",
            value: "На данный анализатор предоставляется стандартная гарантия сроком 1-year.",
            original: "На данный анализатор предоставляется стандартная гарантия сроком 1-year.",
            type: "nonTargetLanguage"
          }
        ]
      }
    },
    nonTargetDetails: [],
    qualityRows: {
      sourceRows: [{ content: "This analyzer comes with a standard 1-year warranty." }],
      targetRows: [{ content: "На данный анализатор предоставляется стандартная гарантия сроком 1-year." }]
    },
    formatLocationLabel: (rowIndex, columnKey) => `R${rowIndex + 1}/${columnKey}`
  });
  assert.equal(sourceTargetFindings[0].original, "This analyzer comes with a standard 1-year warranty.");
  assert.equal(sourceTargetFindings[0].translated, "На данный анализатор предоставляется стандартная гарантия сроком 1-year.");
  assert.equal(sourceTargetFindings[1].original, "This analyzer comes with a standard 1-year warranty.");
  const sourceTargetReportText = buildQualityReportText({
    qualityReport: {
      totals: qualityReport.totals,
      issues: {
        chinese: [],
        placeholders: [],
        idMismatch: [],
        spacing: sourceTargetFindings
          .filter((finding) => finding.category === "spacing")
          .map((finding) => ({
            rowIndex: finding.rowIndex,
            columnKey: finding.columnKey,
            locationLabel: finding.locationLabel,
            value: finding.translated,
            original: finding.translated,
            type: "spacing",
            severity: "medium"
          })),
        emptyTranslations: [],
        structureMismatches: [],
        nonTargetLanguage: []
      }
    },
    nonTargetDetails: [],
    qualityRows: {
      sourceRows: [{ content: "This analyzer comes with a standard 1-year warranty." }],
      targetRows: [{ content: "На данный анализатор предоставляется стандартная гарантия сроком 1-year." }]
    },
    targetLang: "Russian",
    formatLocationLabel: (rowIndex, columnKey) => `R${rowIndex + 1}/${columnKey}`,
    generatedAt: new Date("2026-01-01T00:00:00.000Z")
  });
  assert.match(sourceTargetReportText, /Source: This analyzer comes with a standard 1-year warranty\./);
  assert.match(sourceTargetReportText, /Target: На данный анализатор предоставляется стандартная гарантия сроком 1-year\./);
  assert.equal(mapQualityFindingToIssueType(findings[0]), "non-target-residual");
  assert.equal(mapQualityFindingToIssueType(findings[1]), "number-unit-format");
  const reportText = buildQualityReportText({
    qualityReport,
    nonTargetDetails: [{ rowIndex: 0, columnKey: "content", locationLabel: "DOCX segment 1", value: "List контрольных образцов" }],
    qualityRows: {
      sourceRows: [{ content: "List of control samples" }, { content: "%s" }],
      targetRows: [{ content: "List контрольных образцов" }, { content: "__TKN_1__" }]
    },
    targetLang: "Russian",
    formatLocationLabel: (rowIndex, columnKey) => `R${rowIndex + 1}/${columnKey}`,
    generatedAt: new Date("2026-01-01T00:00:00.000Z")
  });
  assert.match(reportText, /Target language: Russian/);
  assert.match(reportText, /Non-target residual: 1 cells \/ 1 rows/);
  assert.match(reportText, /\[Placeholder\] DOCX segment 2/);

  const advisoryReportText = buildQualityReportText({
    qualityReport: {
      totals: {
        ...qualityReport.totals,
        nonTargetCells: 1,
        nonTargetRows: 1
      },
      issues: {
        chinese: [],
        placeholders: [],
        idMismatch: [],
        spacing: [],
        emptyTranslations: [],
        structureMismatches: [],
        nonTargetLanguage: [
          {
            rowIndex: 0,
            columnKey: "content",
            locationLabel: "DOCX segment 1",
            value: "Задайте настройки отображения времени в формате 24-hour.",
            original: "Set 24-hour time display.",
            type: "nonTargetLanguage"
          },
          {
            rowIndex: 1,
            columnKey: "content",
            locationLabel: "DOCX segment 2",
            value: "Нажмите кнопку «Save».",
            original: "Click the 'Save' button.",
            type: "nonTargetLanguage",
            severity: "low"
          }
        ]
      }
    },
    nonTargetDetails: [
      { rowIndex: 0, columnKey: "content", locationLabel: "DOCX segment 1", value: "Задайте настройки отображения времени в формате 24-hour." },
      { rowIndex: 1, columnKey: "content", locationLabel: "DOCX segment 2", value: "Нажмите кнопку «Save»." }
    ],
    qualityRows: {
      sourceRows: [{ content: "Set 24-hour time display." }, { content: "Click the 'Save' button." }],
      targetRows: [{ content: "Задайте настройки отображения времени в формате 24-hour." }, { content: "Нажмите кнопку «Save»." }]
    },
    targetLang: "Russian",
    formatLocationLabel: (rowIndex, columnKey) => `R${rowIndex + 1}/${columnKey}`,
    generatedAt: new Date("2026-01-01T00:00:00.000Z")
  });
  assert.match(advisoryReportText, /Non-target residual: 1 cells \/ 1 rows/);
  assert.match(advisoryReportText, /\[Non-target language advisory \/ LOW\] DOCX segment 2/);

  const debugPackage = JSON.parse(
    serializeDebugPackage({
      appVersion: "0.0.0-test",
      documentKind: "docx",
      targetLang: "Russian",
      fileName: "sample.docx",
      modelLabel: "Auto",
      modelPreference: "auto-openrouter",
      generatedAt: new Date("2026-01-01T00:00:00.000Z"),
      qualityReport,
      issueSummary: {
        cells: 1,
        rows: 1,
        rowIndices: [0],
        missingRows: [],
        details: [{ rowIndex: 0, columnKey: "content", locationLabel: "DOCX segment 1", value: "List контрольных образцов" }]
      },
      qualityFindings: findings,
      issueCases: [issueCase],
      qualityRows: {
        sourceRows: [{ content: "List of control samples" }],
        targetRows: [{ content: "List контрольных образцов" }]
      },
      formatSnapshot: { sheetName: "DOCX", rows: 1, cols: 1 }
    })
  );
  assert.equal(debugPackage.schema, "poct.translation_debug_package.v1");
  assert.equal(debugPackage.metadata.appVersion, "0.0.0-test");
  assert.equal(debugPackage.issueCases.count, 1);
  assert.equal(debugPackage.samples.issueRows[0].source.content, "List of control samples");
  const regressionCases = buildRegressionCasesFromIssueCases([issueCase]);
  assert.equal(regressionCases.length, 1);
  assert.deepEqual(regressionCases[0].assertions, ["bad-fails-target-language", "expected-passes-target-language"]);
  assert.equal(runRegressionCases(regressionCases).failed, 0);
  assert.equal(buildRegressionCasesFromDebugPackage(debugPackage).length, 1);
  assert.equal(parseRegressionCasesJsonl(serializeRegressionCasesJsonl(regressionCases)).length, 1);
  assert.equal(buildTranslationMemoryPairsFromIssueCases([issueCase], "sample.docx")[0].targetText, "5.1 Список контрольных образцов");
  assert.equal(buildTerminologyCandidatesFromIssueCases([issueCase]).length, 1);
  assert.equal(buildQaRuleCandidatesFromIssueCases([issueCase])[0].ruleType, "target-language-residual");
  const assetPackage = buildIssueAssetPackage([issueCase], {
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    fileName: "sample.docx"
  });
  assert.equal(assetPackage.schema, "poct.translation_issue_assets.v1");
  assert.equal(assetPackage.counts.translationMemoryPairs, 1);
  assert.equal(assetPackage.counts.qaRuleCandidates, 1);

  const issueMarkdown = serializeGitHubIssueMarkdown({
    appVersion: "0.0.0-test",
    documentKind: "docx",
    targetLang: "Russian",
    fileName: "sample.docx",
    modelLabel: "Auto",
    modelPreference: "auto-openrouter",
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    qualityReport,
    issueSummary: {
      cells: 1,
      rows: 1,
      rowIndices: [0],
      missingRows: [],
      details: [{ rowIndex: 0, columnKey: "content", locationLabel: "DOCX segment 1", value: "List контрольных образцов" }]
    },
    qualityFindings: findings,
    issueCases: [issueCase],
    qualityRows: {
      sourceRows: [{ content: "List of control samples" }],
      targetRows: [{ content: "List контрольных образцов" }]
    },
    formatSnapshot: { sheetName: "DOCX", rows: 1, cols: 1 }
  });
  assert.match(issueMarkdown, /\[Translation Bug\]/);
  assert.match(issueMarkdown, /Debug Package/);
  assert.match(issueMarkdown, /DOCX segment 1/);
});

test("quality core adapters preserve existing row-based quality checks", async () => {
  const { rowsToQualityUnits, qualityRowsToUnits, segmentsToQualityRows, segmentsToQualityUnits } = await bundleTsModule(
    path.join(repoRoot, "quality/adapters.ts")
  );
  const { runQualityChecks, runQualityChecksOnUnits } = await bundleTsModule(
    path.join(repoRoot, "utils/quality.ts")
  );
  const {
    guardTranslationTokens,
    hasUntranslatedUiLabelResidue,
    isLikelyIdentifier,
    restoreTranslationTokens
  } = await bundleTsModule(
    path.join(repoRoot, "utils/translationTokens.ts")
  );
  const appSource = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf8");
  const checksSource = fs.readFileSync(path.join(repoRoot, "quality/checks.ts"), "utf8");
  const compatibilitySource = fs.readFileSync(path.join(repoRoot, "utils/quality.ts"), "utf8");
  assert.match(checksSource, /runQualityChecksOnUnits/);
  assert.match(checksSource, /isLikelyTargetLanguage/);
  assert.match(checksSource, /stripProtectedTerms/);
  assert.match(compatibilitySource, /from '..\/quality\/checks'/);

  const sourceRows = [
    { id: "A-001", content: "白细胞", note: "2-8°C" },
    { id: "B-002", content: "血小板", placeholder: "%s" }
  ];
  const targetRows = [
    { id: "A-999", content: "White blood cell", note: "2 - 8 °C" },
    { id: "B-002", content: "", placeholder: "__TKN_1__" },
    { id: "C-003", content: "Unexpected row" }
  ];

  const input = rowsToQualityUnits(sourceRows, targetRows, "excel");
  assert.equal(input.rowsScanned, 3);
  assert.ok(input.units.some((unit) => unit.documentKind === "excel" && unit.columnKey === "__ROW__"));
  assert.deepEqual(runQualityChecksOnUnits(input), runQualityChecks(sourceRows, targetRows));
  assert.equal(
    runQualityChecksOnUnits(input, { targetLang: "Russian" }).issues.nonTargetLanguage.some((issue) => issue.value === "White blood cell"),
    true
  );
  assert.deepEqual(
    runQualityChecksOnUnits(
      segmentsToQualityUnits(
        [
          {
            original: "Ehome Health Technology Co., Ltd. reserves the right.",
            translated: "Ehome Health Technology Co., Ltd. оставляет за собой право."
          }
        ],
        "docx",
        (segment) => segment.translated
      ),
      { targetLang: "Russian" }
    ).issues.nonTargetLanguage.length,
    0
  );
  assert.equal(isLikelyIdentifier("Model: EHVT-75"), false);
  assert.equal(isLikelyIdentifier("EHVT-75"), true);
  const guardedEnglish = guardTranslationTokens("Enter access process CE EN");
  assert.equal(guardedEnglish.sanitized.includes("Enter access process"), true);
  assert.equal(guardedEnglish.sanitized.includes("__ID_"), true);
  assert.equal(restoreTranslationTokens(guardedEnglish.sanitized, guardedEnglish.placeholders), "Enter access process CE EN");
  const guardedUi = guardTranslationTokens("Click the 'Save' button and open the Clinic Information icon from [Home].");
  assert.match(guardedUi.sanitized, /Save|Clinic Information|Home/);
  const guardedCodeUi = guardTranslationTokens("Open the 'QC' tab and connect [USB2.0].");
  assert.doesNotMatch(guardedCodeUi.sanitized, /QC|USB2\.0/);
  assert.equal(
    restoreTranslationTokens(guardedUi.sanitized, guardedUi.placeholders),
    "Click the 'Save' button and open the Clinic Information icon from [Home]."
  );
  assert.equal(
    restoreTranslationTokens(guardedCodeUi.sanitized, guardedCodeUi.placeholders),
    "Open the 'QC' tab and connect [USB2.0]."
  );
  assert.equal(hasUntranslatedUiLabelResidue("Haga clic en «Save».", "", "Spanish"), true);
  assert.equal(hasUntranslatedUiLabelResidue("Haga clic en «Guardar».", "", "Spanish"), false);
  assert.equal(hasUntranslatedUiLabelResidue("Abra la pestaña «QC».", "", "Spanish"), false);
  assert.equal(
    hasUntranslatedUiLabelResidue(
      'Haga clic en 【New Account】 para crear una cuenta nueva. La contraseña predeterminada es "ozelle".',
      'Click 【New Account】 to create a new account. The default password is "ozelle".',
      "Spanish"
    ),
    true
  );
  assert.equal(
    hasUntranslatedUiLabelResidue(
      'Haga clic en 【Nueva cuenta】 para crear una cuenta nueva. La contraseña predeterminada es "ozelle".',
      'Click 【New Account】 to create a new account. The default password is "ozelle".',
      "Spanish"
    ),
    false
  );
  assert.match(appSource, /shouldTranslateCellValue\('', value, target/);
  assert.match(appSource, /buildDocumentIssueDetailsFromQuality/);
  assert.deepEqual(
    runQualityChecksOnUnits(
      segmentsToQualityUnits(
        [
          { original: "Wi-Fi", translated: "Wi-Fi" },
          { original: "NST/WBC%", translated: "NST/WBC%" },
          { original: "BLOOD_002", translated: "BLOOD_002" },
          { original: "Taenia Tapeworm Egg", translated: "Яйцо цепня Taenia" },
          { original: "The device volume", translated: "Громкость device" },
          { original: "Click the 'Save' button.", translated: "Нажмите кнопку «Save»." },
          { original: "   ", translated: "   " }
        ],
        "docx",
        (segment) => segment.translated,
        (segment) => segment.original
      ),
      { targetLang: "Russian" }
    ).issues.nonTargetLanguage.map((issue) => [issue.original, issue.severity || "blocking"]),
    [
      ["The device volume", "blocking"],
      ["Click the 'Save' button.", "blocking"]
    ]
  );
  const russianNoiseReport = runQualityChecksOnUnits(
    segmentsToQualityUnits(
      [
        { original: "10^12/L", translated: "10^12/L" },
        { original: "Tg#", translated: "Tg#" },
        { original: "B-IV hemolytic agent", translated: "Гемолитический агент B-IV" },
        { original: "240μL", translated: "240μL" },
        { original: "5.00×109/L~17.00×109/L", translated: "5.00×109/L~17.00×109/L" },
        { original: "35fL~53fL", translated: "35 fL~53 fL" },
        {
          original: "Manufacturer Address: Room 103 and 104, No.13 Building, Country Garden Wisdom Garden, Xueshi Street, Yuelu District, Changsha, Hunan, P. R. China",
          translated: "Адрес производителя: комната 103 и 104, здание № 13, Country Garden Wisdom Garden, улица Xueshi, район Yuelu, Changsha, Hunan, КНР"
        },
        {
          original: "Set 24-hour time display.",
          translated: "Задайте настройки отображения времени в формате 24-hour."
        },
        { original: "Website: https://ozellemed.com/", translated: "Веб-сайт: https://ozellemed.com/" },
        { original: "Click the 'Save' button.", translated: "Нажмите кнопку «Save»." }
      ],
      "docx",
      (segment) => segment.translated,
      (segment) => segment.original
    ),
    { targetLang: "Russian" }
  );
  assert.deepEqual(
    russianNoiseReport.issues.nonTargetLanguage.map((issue) => [issue.original, issue.severity || "blocking"]),
    [
      ["Set 24-hour time display.", "blocking"],
      ["Click the 'Save' button.", "blocking"]
    ]
  );
  assert.equal(russianNoiseReport.totals.nonTargetCells, 2);
  assert.equal(russianNoiseReport.totals.nonTargetRows, 2);
  assert.deepEqual(
    runQualityChecksOnUnits(
      segmentsToQualityUnits(
        [
          { original: "Haga clic en «Save».", translated: "Haga clic en «Save»." },
          { original: "Abra la pestaña «QC».", translated: "Abra la pestaña «QC»." }
        ],
        "docx",
        (segment) => segment.translated,
        (segment) => segment.original
      ),
      { targetLang: "Spanish" }
    ).issues.nonTargetLanguage.map((issue) => issue.value),
    ["Haga clic en «Save»."]
  );
  assert.equal(
    runQualityChecksOnUnits(
      segmentsToQualityUnits(
        [
          {
            original: 'Click 【New Account】 to create a new account. The default password is "ozelle".',
            translated: 'Haga clic en 【Nueva cuenta】 para crear una cuenta nueva. La contraseña predeterminada es "ozelle".'
          }
        ],
        "docx",
        (segment) => segment.translated,
        (segment) => segment.original
      ),
      { targetLang: "Spanish" }
    ).issues.nonTargetLanguage.length,
    0
  );
  assert.equal(
    russianNoiseReport.issues.spacing.some((issue) => issue.original === "Website: https://ozellemed.com/"),
    false
  );
  assert.equal(
    runQualityChecksOnUnits(
      segmentsToQualityUnits(
        [{ original: "", translated: "   " }],
        "docx",
        (segment) => segment.translated,
        (segment) => segment.original
      ),
      { targetLang: "Russian" }
    ).issues.spacing.length,
    0
  );
  assert.equal(
    runQualityChecks([{ id: "da224cff-fd10-4d8f-b374-66b5d0ff6e70" }], [{ id: "da224cff-fd10-4d8f-b374-66b5d0ff6e70" }]).issues.spacing.length,
    0
  );
  assert.equal(
    runQualityChecksOnUnits(
      segmentsToQualityUnits(
        [{ original: "白细胞升高", translated: "WBCs are increased and RBCs are stable." }],
        "excel",
        (segment) => segment.translated,
        (segment) => segment.original
      ),
      { targetLang: "English" }
    ).totals.spacingHigh,
    0
  );
  assert.equal(
    runQualityChecksOnUnits(
      segmentsToQualityUnits(
        [{ original: "维生素B12缺乏", translated: "Vitamin B 12 deficiency." }],
        "excel",
        (segment) => segment.translated,
        (segment) => segment.original
      ),
      { targetLang: "English" }
    ).issues.spacing.length,
    0
  );
  assert.equal(
    runQualityChecksOnUnits(
      segmentsToQualityUnits(
        [
          {
            original: "示例",
            translated: "Can manifest as abnormalities (e. g. , amylase); etc. ; Ehome Health Technology Co. , Ltd. ."
          }
        ],
        "excel",
        (segment) => segment.translated,
        (segment) => segment.original
      ),
      { targetLang: "English" }
    ).issues.spacing.length,
    0
  );
  assert.deepEqual(
    qualityRowsToUnits({ sourceRows, targetRows }, "docx").units.map((unit) => unit.documentKind).every((kind) => kind === "docx"),
    true
  );
  const segments = [
    { original: "样本准备", translated: "Sample preparation" },
    { original: "质控", translated: "QC" }
  ];
  assert.deepEqual(
    segmentsToQualityRows(segments, (segment) => segment.translated),
    {
      sourceRows: [{ content: "样本准备" }, { content: "质控" }],
      targetRows: [{ content: "Sample preparation" }, { content: "QC" }]
    }
  );
  assert.deepEqual(
    segmentsToQualityUnits(segments, "pdf", (segment) => segment.translated).units.map((unit) => unit.documentKind),
    ["pdf", "pdf"]
  );
  const segmentInput = segmentsToQualityUnits(
    [{ original: "Sample preparation", translated: "样本准备" }],
    "pdf",
    (segment) => segment.translated,
    (segment) => segment.original,
    (_segment, index) => `PDF segment ${index + 1}`
  );
  assert.equal(segmentInput.units[0].locationLabel, "PDF segment 1");
  assert.equal(runQualityChecksOnUnits(segmentInput).issues.chinese[0].locationLabel, "PDF segment 1");
});

test("retry target helpers reuse quality issue details across document kinds", async () => {
  const {
    buildExcelRetryTargets,
    buildRetryableExcelSummary,
    buildTextSegmentRetryPlan,
    shouldTranslateCellValue
  } = await bundleTsModule(path.join(repoRoot, "utils/retryTargets.ts"));
  const appSource = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf8");

  const sourceRows = [
    { id: "A-001", content: "List контрольных образцов", unit: "2-8°C" },
    { id: "LOCK-1", content: "Home Главная страница", note: "%s" }
  ];
  const details = [
    { rowIndex: 0, columnKey: "content", value: "List контрольных образцов" },
    { rowIndex: 0, columnKey: "id", value: "A-001" },
    { rowIndex: 1, columnKey: "content", value: "Home Главная страница" },
    { rowIndex: 1, columnKey: "note", value: "%s" }
  ];
  const isRetryableCell = ({ columnKey, value }) =>
    columnKey !== "id" && value.trim() !== "%s";
  const guardTranslationTokens = (value) => ({
    sanitized: value.replace("Home", "__TKN_1__"),
    placeholders: value.includes("Home") ? { "__TKN_1__": "Home" } : null
  });

  assert.equal(
    shouldTranslateCellValue("content", "Haga clic en «Save».", "Spanish"),
    true
  );
  assert.equal(
    shouldTranslateCellValue("content", "Haga clic en «Guardar».", "Spanish"),
    false
  );
  assert.equal(
    shouldTranslateCellValue("content", "Abra la pestaña «QC».", "Spanish"),
    false
  );
  assert.equal(
    shouldTranslateCellValue("id", "A-001", "Spanish", {
      shouldLockCell: (key) => key === "id"
    }),
    false
  );
  assert.match(appSource, /buildDocumentIssueDetailsFromQuality/);
  assert.match(appSource, /runQualityChecksOnUnits\(/);
  assert.match(appSource, /shouldTranslateCellValue\(key,\s*value,\s*targetLang/);
  assert.doesNotMatch(appSource, /const hasSourceLanguage =/);

  const summary = buildRetryableExcelSummary({
    details,
    originalRows: sourceRows,
    sourceRows,
    isRetryableCell
  });
  assert.deepEqual(summary, { rowIndices: [0, 1], cellCount: 2 });

  const targets = buildExcelRetryTargets({
    rowIndices: [0, 1],
    details,
    originalRows: sourceRows,
    sourceRows,
    isRetryableCell,
    guardTranslationTokens
  });
  assert.equal(targets.length, 2);
  assert.deepEqual(targets[0].keys, new Set(["content", "id"]));
  assert.deepEqual(targets[0].sanitizedRow, { content: "List контрольных образцов" });
  assert.deepEqual(targets[1].sanitizedRow, { content: "__TKN_1__ Главная страница" });
  assert.deepEqual(targets[1].placeholders, { content: { "__TKN_1__": "Home" } });

  assert.deepEqual(
    buildTextSegmentRetryPlan(
      [
        { index: 2, lowPriority: true },
        { index: 5, lowPriority: false },
        { index: 8, lowPriority: true }
      ],
      [2, 5, 8]
    ),
    {
      targetIndices: [5],
      recommendedIndices: [5],
      skippedLowPriority: 2,
      fallbackToLowPriority: false
    }
  );
  assert.deepEqual(
    buildTextSegmentRetryPlan([{ index: 3, lowPriority: true }], [3]),
    {
      targetIndices: [3],
      recommendedIndices: [],
      skippedLowPriority: 1,
      fallbackToLowPriority: true
    }
  );
});

test("Traditional Chinese Taiwan target has UI, prompt, and quality-check coverage", async () => {
  const appSource = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf8");
  const languageSource = fs.readFileSync(path.join(repoRoot, "utils/language.ts"), "utf8");
  const profileSource = fs.readFileSync(path.join(repoRoot, "utils/translationProfiles.ts"), "utf8");
  const modelReviewSource = fs.readFileSync(path.join(repoRoot, "functions/api/model-review.ts"), "utf8");
  const { TARGET_LANGUAGE_OPTIONS, STRING_RESOURCE_TARGET_LANGS, getTargetLanguageLabel, getTargetLocaleInstruction, isChineseTarget } =
    await transpileTsModule(path.join(repoRoot, "utils/targetLanguage.ts"));
  const { runQualityChecks } = await bundleTsModule(path.join(repoRoot, "quality/checks.ts"));

  assert.ok(TARGET_LANGUAGE_OPTIONS.includes("Traditional Chinese (Taiwan)"));
  assert.ok(STRING_RESOURCE_TARGET_LANGS.includes("Traditional Chinese (Taiwan)"));
  assert.equal(isChineseTarget("Chinese"), true);
  assert.equal(isChineseTarget("Traditional Chinese (Taiwan)"), true);
  assert.equal(isChineseTarget("French"), false);
  assert.equal(
    getTargetLanguageLabel("Traditional Chinese (Taiwan)"),
    "Traditional Chinese (Taiwan) / 繁體中文（台灣）"
  );
  const chineseTargetReport = runQualityChecks(
    [{ content: "Build an AI-native startup", empty: "This should be translated" }],
    [{ content: "打造 AI 原生初创企业", empty: "" }],
    { targetLang: "Chinese" }
  );
  assert.equal(chineseTargetReport.totals.chineseCells, 0);
  assert.equal(chineseTargetReport.issues.chinese.length, 0);
  assert.equal(chineseTargetReport.totals.emptyTranslations, 1);
  assert.match(getTargetLocaleInstruction("Traditional Chinese (Taiwan)"), /Taiwan/);
  assert.match(getTargetLocaleInstruction("Traditional Chinese (Taiwan)"), /品質/);
  assert.match(getTargetLocaleInstruction("Traditional Chinese (Taiwan)"), /Simplified Chinese/);
  assert.match(appSource, /document\.title = APP_VERSION/);
  assert.match(languageSource, /hasSimplifiedChineseResidue/);
  assert.match(languageSource, /isTraditionalChineseTaiwanTarget\(targetLang\) && hasSimplifiedChineseResidue/);
  assert.match(profileSource, /getTargetLocaleInstruction/);
  assert.match(modelReviewSource, /penalize Simplified Chinese characters/);
});

test("Russian and French profiles flag high-confidence source-language residue", async () => {
  const { isLikelyTargetLanguage, detectUntranslatedCells } = await bundleTsModule(
    path.join(repoRoot, "utils/language.ts")
  );
  const { polishTranslation } = await bundleTsModule(path.join(repoRoot, "utils/postprocess.ts"));
  const {
    collectFrenchDiacriticRisks,
    TARGET_LANGUAGE_PROFILES,
    getRussianResidueProfile,
    getTargetLanguageProfile,
    hasProfileEnglishResidue,
    hasFrenchDiacriticRisk,
    isProfileEnglishResidueToken,
    isRussianDisallowedLatinResidue
  } = await bundleTsModule(
    path.join(repoRoot, "utils/languageProfiles.ts")
  );
  const { runQualityChecks } = await bundleTsModule(path.join(repoRoot, "quality/checks.ts"));
  const { getTargetLocaleInstruction } = await bundleTsModule(path.join(repoRoot, "utils/targetLanguage.ts"));

  assert.equal(isLikelyTargetLanguage("Описание продукта", "Russian"), true);
  assert.equal(isLikelyTargetLanguage("Home: Главная страница", "Russian"), false);
  assert.equal(isLikelyTargetLanguage("Orders: Заказы на исследование", "Russian"), false);
  assert.equal(isLikelyTargetLanguage("Reports: Отчеты об исследовании", "Russian"), false);
  assert.equal(isLikelyTargetLanguage("AI analysis: Анализ отчета AI", "Russian"), false);
  assert.equal(isLikelyTargetLanguage("5.1 List контрольных образцов", "Russian"), false);
  assert.equal(isLikelyTargetLanguage("feces reference: справка", "Russian"), false);
  assert.equal(isLikelyTargetLanguage("Building Street: адрес", "Russian"), false);
  assert.equal(isLikelyTargetLanguage("Гарантия составляет 1-year.", "Russian"), false);
  assert.equal(isLikelyTargetLanguage("Отображать время в формате 24-hour.", "Russian"), false);
  assert.equal(isLikelyTargetLanguage("10^12/L", "Russian"), true);
  assert.equal(isLikelyTargetLanguage("Гемолитический агент B-IV", "Russian"), true);
  assert.equal(isLikelyTargetLanguage("Гемолитические агенты R-IV", "Russian"), true);
  assert.equal(isLikelyTargetLanguage("240μL", "Russian"), true);
  assert.equal(isLikelyTargetLanguage("5.00×109/L~17.00×109/L", "Russian"), true);
  assert.equal(isLikelyTargetLanguage("35 fL~53 fL", "Russian"), true);
  assert.equal(
    isLikelyTargetLanguage(
      "Адрес производителя: комната 103 и 104, здание № 13, Country Garden Wisdom Garden, улица Xueshi, район Yuelu, Changsha, Hunan, КНР",
      "Russian"
    ),
    true
  );
  assert.equal(isLikelyTargetLanguage("Tg#", "Russian"), true);
  assert.equal(isLikelyTargetLanguage("Веб-сайт: https://ozellemed.com/", "Russian"), true);
  assert.equal(isLikelyTargetLanguage("далее refме", "Russian"), false);
  assert.equal(isLikelyTargetLanguage("OpenDx: руководство пользователя", "Russian"), true);
  assert.equal(isLikelyTargetLanguage("POCT QC: контроль качества", "Russian"), true);
  assert.equal(polishTranslation("", "Reports: Отчеты об исследовании", "Russian"), "Отчеты: Отчеты об исследовании");
  assert.equal(polishTranslation("", "Гарантия составляет 1-year.", "Russian").trim(), "Гарантия составляет 1 год.");
  assert.equal(
    polishTranslation("", "1. 1 Ámbito de aplicación y 7. 2. 10 Acerca de", "Spanish").trim(),
    "1.1 Ámbito de aplicación y 7.2.10 Acerca de"
  );
  assert.equal(
    polishTranslation("", "Отображение времени в формате 24-hour (при отключении отображается в формате 12-hour).", "Russian").trim(),
    "Отображение времени в 24-часовом формате (при отключении отображается в 12-часовом формате)."
  );
  assert.equal(
    polishTranslation("", "Это не только повыceет эффективность, но и сниceет ошибки в спиlisку.", "Russian").trim(),
    "Это не только повышает эффективность, но и снижает ошибки в списку."
  );
  assert.equal(
    polishTranslation("", "ВвеEnте URL-адрес, нажмите En Enter, чтобы полуceить доступ к проceсс.", "Russian").trim(),
    "Введите URL-адрес, нажмите Enter, чтобы получить доступ к процесс."
  );
  assert.equal(
    polishTranslation("", "Нажмите на значок Account Management, чтобы перейти. Запись entry прибора instrument.", "Russian").trim(),
    "Нажмите на значок управление учетными записями, чтобы перейти. Запись прибора прибор."
  );
  assert.equal(
    polishTranslation("", "Интерфейс питания DCce", "Russian").trim(),
    "Интерфейс питания DC"
  );
  assert.equal(
    polishTranslation("", "Ehome Health Technology Co. , Ltd. . поддерживает принтер A 4 и https://ozellemed. com/.", "Russian").trim(),
    "Ehome Health Technology Co., Ltd. поддерживает принтер A4 и https://ozellemed.com/."
  );
  assert.equal(
    polishTranslation(
      "",
      "Can manifest as abnormalities (e. g. , amylase); etc. ; Ehome Health Technology Co. , Ltd. .",
      "English"
    ).trim(),
    "Can manifest as abnormalities (e.g., amylase); etc.; Ehome Health Technology Co., Ltd."
  );
  assert.ok(getRussianResidueProfile().disallowedLatinResidueWords.includes("home"));
  assert.equal(isRussianDisallowedLatinResidue("Reports"), true);
  assert.equal(isRussianDisallowedLatinResidue("year"), true);
  assert.ok(TARGET_LANGUAGE_PROFILES.french.commonFunctionWords.includes("avec"));
  assert.ok(TARGET_LANGUAGE_PROFILES.french.englishResidueWords.includes("quickly"));
  assert.ok(TARGET_LANGUAGE_PROFILES.french.diacriticRiskWords.some((item) => item.plain === "hemoglobine"));
  assert.equal(getTargetLanguageProfile("French")?.target, "French");
  assert.equal(isLikelyTargetLanguage("Remplissage de l'échantillon", "French"), true);
  assert.equal(isLikelyTargetLanguage("Hemoglobine elevee avec anemie legere.", "French"), false);
  assert.equal(isLikelyTargetLanguage("Hémoglobine élevée avec anémie légère.", "French"), true);
  assert.equal(isLikelyTargetLanguage("Quickly squeeze", "French"), false);
  assert.equal(isLikelyTargetLanguage("The blue button is lifted", "French"), false);
  assert.equal(isLikelyTargetLanguage("Insérez le flacon quadruple dans l'injecteur d'échantillon.", "French"), true);
  assert.equal(isProfileEnglishResidueToken("squeeze", "French"), true);
  assert.equal(hasProfileEnglishResidue("The blue button is lifted", "French"), true);
  assert.equal(hasFrenchDiacriticRisk("Hemoglobine elevee avec anemie legere.", "French"), true);
  assert.deepEqual(
    collectFrenchDiacriticRisks("Hemoglobine elevee avec anemie legere.", "French").map((item) => item.preferred),
    ["hémoglobine", "élevée", "anémie", "légère"]
  );
  assert.match(getTargetLocaleInstruction("French"), /hémoglobine/);
  assert.equal(getTargetLanguageProfile("Traditional Chinese (Taiwan)")?.preferredLocale, "zh-TW");

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
  const frenchIssues = detectUntranslatedCells(
    [
      { content: "Remplissage de l'échantillon" },
      { content: "Hemoglobine elevee avec anemie legere." },
      { content: "Quickly squeeze" },
      { content: "The blue button is lifted" }
    ],
    "French"
  );
  assert.deepEqual(
    frenchIssues.map((issue) => issue.value),
    ["Hemoglobine elevee avec anemie legere.", "Quickly squeeze", "The blue button is lifted"]
  );
  const frenchQualityReport = runQualityChecks(
    [{ content: "血红蛋白升高，提示轻度贫血" }],
    [{ content: "Hemoglobine elevee avec anemie legere." }],
    { targetLang: "French" }
  );
  assert.equal(frenchQualityReport.totals.nonTargetCells, 1);
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
    assert.deepEqual(calls[0].provider, { sort: "throughput", allow_fallbacks: true });
    assert.match(calls[0].messages[0].content, /IFU|operator manual/i);
  });
});

test("API translate auto uses Cloudflare AI Gateway Gemini before OpenRouter", async () => {
  const { onRequestPost } = await bundleTsModule(path.join(repoRoot, "functions/api/translate.ts"));
  const aiCalls = [];
  let fetchCalled = false;

  await withMockedFetch(async (setFetch) => {
    setFetch(async () => {
      fetchCalled = true;
      throw new Error("OpenRouter should not be called when Cloudflare AI succeeds.");
    });

    const response = await onRequestPost(
      functionContext(
        {
          records: [{ id: "seg-1", content: "打开仪器" }],
          targetLang: "Spanish",
          engine: "auto",
          profile: "docx-manual"
        },
        {
          AI: {
            run: async (model, input, options) => {
              aiCalls.push({ model, input, options });
              return {
                candidates: [
                  {
                    content: {
                      role: "model",
                      parts: [
                        {
                          text: JSON.stringify({
                            records: [{ id: "seg-1", content: "Encienda el instrumento." }]
                          })
                        }
                      ]
                    },
                    finishReason: "STOP"
                  }
                ],
                modelVersion: "gemini-3-flash-preview",
                gatewayMetadata: { keySource: "Unified" }
              };
            }
          },
          CLOUDFLARE_AI_MODELS: "google/gemini-3-flash",
          CLOUDFLARE_AI_MAX_OUTPUT_TOKENS: "2048"
        }
      )
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.engine, "cloudflare-ai");
    assert.equal(payload.model, "google/gemini-3-flash");
    assert.deepEqual(payload.records, [{ id: "seg-1", content: "Encienda el instrumento." }]);
    assert.equal(fetchCalled, false);
    assert.equal(aiCalls.length, 1);
    assert.equal(aiCalls[0].model, "google/gemini-3-flash");
    assert.equal(aiCalls[0].input.max_tokens, 2048);
    assert.deepEqual(aiCalls[0].options, { gateway: { id: "default" } });
  });
});

test("API translate auto falls back to OpenRouter when Cloudflare AI fails", async () => {
  const { onRequestPost } = await bundleTsModule(path.join(repoRoot, "functions/api/translate.ts"));
  const calls = [];

  await withMockedFetch(async (setFetch) => {
    setFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push({ provider: "openrouter", model: body.model });
      return openRouterResponse(
        JSON.stringify({
          records: [{ id: "seg-1", content: "Fallback translated sentence." }]
        })
      );
    });

    const response = await onRequestPost(
      functionContext(
        {
          records: [{ id: "seg-1", content: "中文说明" }],
          targetLang: "English",
          engine: "auto"
        },
        {
          AI: {
            run: async (model) => {
              calls.push({ provider: "cloudflare-ai", model });
              throw new Error("Cloudflare AI temporary error");
            }
          },
          OPENROUTER_MODELS: "qwen/qwen3.6-plus"
        }
      )
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      { provider: "cloudflare-ai", model: "google/gemini-3-flash" },
      { provider: "cloudflare-ai", model: "openai/gpt-5.4" },
      { provider: "cloudflare-ai", model: "anthropic/claude-sonnet-4.6" },
      { provider: "openrouter", model: "qwen/qwen3.6-plus" }
    ]);
    assert.equal(payload.engine, "openrouter");
    assert.equal(payload.model, "qwen/qwen3.6-plus");
    assert.deepEqual(payload.records, [{ id: "seg-1", content: "Fallback translated sentence." }]);
    assert.equal(payload.modelIssues[0].model, "google/gemini-3-flash");
    assert.equal(payload.modelIssues[0].kind, "exception");
  });
});

test("API translate can call DeepSeek official API directly with thinking disabled", async () => {
  const { onRequestPost } = await bundleTsModule(path.join(repoRoot, "functions/api/translate.ts"));
  const calls = [];

  await withMockedFetch(async (setFetch) => {
    setFetch(async (url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url: String(url), body, headers: init.headers });
      return openRouterResponse(
        JSON.stringify({
          records: [{ id: "seg-1", content: "Direct DeepSeek translated sentence." }]
        })
      );
    });

    const response = await onRequestPost(
      functionContext(
        {
          records: [{ id: "seg-1", content: "中文说明" }],
          targetLang: "English",
          engine: "deepseek",
          model: "deepseek-v4-pro",
          profile: "docx-manual"
        },
        {
          DEEPSEEK_API_KEY: "test-deepseek-key",
          DEEPSEEK_MODELS: "deepseek-v4-flash",
          OPENROUTER_API_KEY: ""
        }
      )
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.engine, "deepseek");
    assert.equal(payload.model, "deepseek-v4-pro");
    assert.deepEqual(payload.records, [{ id: "seg-1", content: "Direct DeepSeek translated sentence." }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
    assert.equal(calls[0].body.model, "deepseek-v4-pro");
    assert.equal(calls[0].body.max_tokens, 24576);
    assert.deepEqual(calls[0].body.thinking, { type: "disabled" });
    assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
    assert.match(calls[0].body.messages[0].content, /IFU|operator manual/i);
  });
});

test("API translate auto tries DeepSeek official API before OpenRouter when Cloudflare AI fails", async () => {
  const { onRequestPost } = await bundleTsModule(path.join(repoRoot, "functions/api/translate.ts"));
  const calls = [];

  await withMockedFetch(async (setFetch) => {
    setFetch(async (url, init) => {
      const body = JSON.parse(String(init.body));
      const provider = String(url).includes("api.deepseek.com") ? "deepseek" : "openrouter";
      calls.push({ provider, model: body.model });
      if (provider === "openrouter") {
        throw new Error("OpenRouter should not be called when DeepSeek succeeds.");
      }
      return openRouterResponse(
        JSON.stringify({
          records: [{ id: "seg-1", content: "DeepSeek fallback translated sentence." }]
        })
      );
    });

    const response = await onRequestPost(
      functionContext(
        {
          records: [{ id: "seg-1", content: "中文说明" }],
          targetLang: "English",
          engine: "auto"
        },
        {
          AI: {
            run: async (model) => {
              calls.push({ provider: "cloudflare-ai", model });
              throw new Error("Cloudflare AI temporary error");
            }
          },
          DEEPSEEK_API_KEY: "test-deepseek-key",
          DEEPSEEK_MODELS: "deepseek-v4-flash",
          CLOUDFLARE_AI_MODELS: "google/gemini-3-flash,openai/gpt-5.4,anthropic/claude-sonnet-4.6",
          OPENROUTER_MODELS: "qwen/qwen3.6-plus"
        }
      )
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      { provider: "cloudflare-ai", model: "google/gemini-3-flash" },
      { provider: "deepseek", model: "deepseek-v4-flash" }
    ]);
    assert.equal(payload.engine, "deepseek");
    assert.equal(payload.model, "deepseek-v4-flash");
    assert.deepEqual(payload.records, [{ id: "seg-1", content: "DeepSeek fallback translated sentence." }]);
    assert.equal(payload.modelIssues[0].model, "google/gemini-3-flash");
    assert.equal(payload.modelIssues[0].kind, "exception");
  });
});

test("API translate auto tries DeepSeek Pro before Cloudflare GPT and Claude fallbacks", async () => {
  const { onRequestPost } = await bundleTsModule(path.join(repoRoot, "functions/api/translate.ts"));
  const calls = [];

  await withMockedFetch(async (setFetch) => {
    setFetch(async (url, init) => {
      const body = JSON.parse(String(init.body));
      const provider = String(url).includes("api.deepseek.com") ? "deepseek" : "openrouter";
      calls.push({ provider, model: body.model });
      if (provider === "openrouter") {
        throw new Error("OpenRouter should not be called when DeepSeek Pro succeeds.");
      }
      if (body.model === "deepseek-v4-flash") {
        return new Response(JSON.stringify({ error: { message: "Flash temporarily unavailable" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        });
      }
      return openRouterResponse(
        JSON.stringify({
          records: [{ id: "seg-1", content: "DeepSeek Pro translated sentence." }]
        })
      );
    });

    const response = await onRequestPost(
      functionContext(
        {
          records: [{ id: "seg-1", content: "中文说明" }],
          targetLang: "English",
          engine: "auto"
        },
        {
          AI: {
            run: async (model) => {
              calls.push({ provider: "cloudflare-ai", model });
              if (model !== "google/gemini-3-flash") {
                throw new Error("Cloudflare GPT/Claude should run after DeepSeek Pro.");
              }
              throw new Error("Cloudflare Gemini temporary error");
            }
          },
          DEEPSEEK_API_KEY: "test-deepseek-key",
          DEEPSEEK_MODELS: "deepseek-v4-flash,deepseek-v4-pro",
          CLOUDFLARE_AI_MODELS: "google/gemini-3-flash,openai/gpt-5.4,anthropic/claude-sonnet-4.6",
          OPENROUTER_MODELS: "qwen/qwen3.6-plus"
        }
      )
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      { provider: "cloudflare-ai", model: "google/gemini-3-flash" },
      { provider: "deepseek", model: "deepseek-v4-flash" },
      { provider: "deepseek", model: "deepseek-v4-pro" }
    ]);
    assert.equal(payload.engine, "deepseek");
    assert.equal(payload.model, "deepseek-v4-pro");
    assert.deepEqual(payload.records, [{ id: "seg-1", content: "DeepSeek Pro translated sentence." }]);
    assert.deepEqual(
      payload.modelIssues.map((issue) => issue.model),
      ["google/gemini-3-flash", "deepseek-v4-flash"]
    );
  });
});

test("API translate auto model chain falls through when Gemini returns an error", async () => {
  const { onRequestPost } = await bundleTsModule(path.join(repoRoot, "functions/api/translate.ts"));
  const calls = [];

  await withMockedFetch(async (setFetch) => {
    setFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push(body.model);
      if (body.model === "google/gemini-3-flash-preview") {
        return new Response(JSON.stringify({ error: { message: "Gemini provider error" } }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
      return openRouterResponse(
        JSON.stringify([
          {
            id: "seg-1",
            content: "Fallback model translated sentence."
          }
        ])
      );
    });

    const response = await onRequestPost(
      functionContext(
        {
          records: [{ id: "seg-1", content: "中文说明" }],
          targetLang: "English",
          engine: "openrouter"
        },
        {
          OPENROUTER_MODELS: "google/gemini-3-flash-preview,qwen/qwen3.6-plus"
        }
      )
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ["google/gemini-3-flash-preview", "qwen/qwen3.6-plus"]);
    assert.equal(payload.model, "qwen/qwen3.6-plus");
    assert.deepEqual(payload.records, [{ id: "seg-1", content: "Fallback model translated sentence." }]);
    assert.equal(payload.modelIssues[0].model, "google/gemini-3-flash-preview");
    assert.equal(payload.modelIssues[0].status, 500);
  });
});

test("API translate auto model chain falls through when a model request times out", async () => {
  const { onRequestPost } = await bundleTsModule(path.join(repoRoot, "functions/api/translate.ts"));
  const calls = [];

  await withMockedFetch(async (setFetch) => {
    setFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push(body.model);
      if (body.model === "qwen/qwen3.6-plus") {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(init.signal.reason || new Error("aborted"));
          });
        });
      }
      return openRouterResponse(
        JSON.stringify([
          {
            id: "seg-1",
            content: "Timeout fallback translated sentence."
          }
        ])
      );
    });

    const response = await onRequestPost(
      functionContext(
        {
          records: [{ id: "seg-1", content: "中文说明" }],
          targetLang: "English",
          engine: "openrouter"
        },
        {
          OPENROUTER_MODELS: "qwen/qwen3.6-plus,deepseek/deepseek-v4-pro",
          OPENROUTER_REQUEST_TIMEOUT_MS: "5"
        }
      )
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ["qwen/qwen3.6-plus", "deepseek/deepseek-v4-pro"]);
    assert.equal(payload.model, "deepseek/deepseek-v4-pro");
    assert.deepEqual(payload.records, [{ id: "seg-1", content: "Timeout fallback translated sentence." }]);
    assert.equal(payload.modelIssues[0].model, "qwen/qwen3.6-plus");
    assert.equal(payload.modelIssues[0].status, "timeout");
  });
});

test("Auto translation passes OpenRouter model chain through string and spreadsheet flows", () => {
  const appSource = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf8");
  assert.match(appSource, /const getTranslationOptions = \(\) => \{/);
  assert.match(appSource, /translationModelPreference === AUTO_OPENROUTER_MODEL[\s\S]*openRouterModels/);
  assert.match(appSource, /String Resource[\s\S]*translationHub\.translateBatch\(\{[\s\S]*options: getTranslationOptions\(\)/);
  assert.match(appSource, /for \(const lang of targetLangs\)/);
  assert.doesNotMatch(appSource, /Promise\.allSettled\(targetLangs\.map/);
  assert.match(appSource, /String Resource: 使用左侧 Translation Model/);
  assert.match(appSource, /applyOpenRouterModelCooldowns/);
  assert.match(appSource, /Auto 将跳过 30 分钟/);
  assert.match(appSource, /currentSkippedOpenRouterModels/);
  assert.match(appSource, /activeOpenRouterModels/);
  assert.match(appSource, /allOpenRouterModels/);
  assert.match(appSource, /getSpreadsheetBatchSize/);
  assert.match(appSource, /const getSpreadsheetBatchSize = \(\) => BATCH_SIZE/);
  assert.match(appSource, /getDocumentBatchPolicy/);
  assert.match(appSource, /isDeepSeekDirectProModel\(translationModelPreference\)/);
  assert.match(appSource, /DEFAULT_CLOUDFLARE_AI_MODELS = \[[\s\S]*google\/gemini-3-flash[\s\S]*openai\/gpt-5\.4[\s\S]*anthropic\/claude-sonnet-4\.6/);
  assert.match(appSource, /const DEFAULT_OPENROUTER_MODELS: string\[\] = \[\]/);
  assert.match(appSource, /const DEFAULT_OPENROUTER_AUTO_MODELS: string\[\] = \[\]/);
  assert.match(appSource, /String Resource 共用此处选择/);
  assert.match(appSource, /这里只单独选择输出语言/);
  assert.match(appSource, /disabled=\{isTranslating \|\| isStringTranslating\}/);
  assert.match(appSource, /DEFAULT_CLOUDFLARE_AI_MODELS/);
  assert.match(appSource, /DEEPSEEK_DIRECT_MODEL_LABEL/);
  assert.match(appSource, /DEEPSEEK_DIRECT_PRO_MODEL_LABEL/);
  assert.match(appSource, /DEEPSEEK_DIRECT_AUTO_LABELS/);
  assert.match(appSource, /splitCloudflareAutoModels/);
  assert.match(appSource, /availableTranslationModels/);
  assert.match(
    appSource,
    /\.\.\.\(capabilities\.deepseek \? DEEPSEEK_DIRECT_MODEL_VALUES : \[\]\),[\s\S]*\.\.\.\(capabilities\.cloudflareAi \? cloudflareAiModels\.map\(toCloudflareAiModelValue\) : \[\]\),/
  );
  assert.match(appSource, /isDeepSeekDirectModel\(translationModelPreference\)[\s\S]*model: 'deepseek' as const[\s\S]*providerModel/);
  assert.match(appSource, /includeDeepSeekDirect \? DEEPSEEK_DIRECT_AUTO_LABELS : \[\]/);
  assert.match(appSource, /formatAutoModelChainLabel\([\s\S]*cloudflareAiModels[\s\S]*activeOpenRouterModels[\s\S]*capabilities\.deepseek/);
});

test("Multi-AI Review defaults compare five translation candidates with three strong judges", async () => {
  const { DEFAULT_MODEL_REVIEW_JUDGE_MODELS, DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS } = await transpileTsModule(
    path.join(repoRoot, "utils/modelReview.ts")
  );
  assert.deepEqual(DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS, [
    "cloudflare-ai:google/gemini-3-flash",
    "deepseek:deepseek-v4-flash",
    "deepseek:deepseek-v4-pro",
    "cloudflare-ai:openai/gpt-5.4",
    "cloudflare-ai:anthropic/claude-sonnet-4.6"
  ]);
  assert.deepEqual(DEFAULT_MODEL_REVIEW_JUDGE_MODELS, [
    "cloudflare-ai:openai/gpt-5.4",
    "cloudflare-ai:anthropic/claude-sonnet-4.6",
    "deepseek:deepseek-v4-pro"
  ]);
});

test("Proxy translation retries transient fetch failures before surfacing string resource errors", async () => {
  const { ProxyTranslationService } = await bundleTsModule(path.join(repoRoot, "services/proxyService.ts"));
  const calls = [];

  await withMockedFetch(async (setFetch) => {
    setFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push(body.targetLang);
      if (calls.length === 1) {
        throw new TypeError("Failed to fetch");
      }
      return new Response(
        JSON.stringify({
          engine: "openrouter",
          records: body.records.map((record) => ({
            ...record,
            content: `${record.content} traduzido`
          }))
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    });

    const service = new ProxyTranslationService("/api/translate");
    const result = await service.translateBatch(
      [{ content: "上传成功" }],
      "Portuguese",
      "openrouter",
      undefined,
      { models: ["google/gemini-3-flash-preview", "qwen/qwen3.6-plus"] }
    );

    assert.deepEqual(calls, ["Portuguese", "Portuguese"]);
    assert.deepEqual(result, [{ content: "上传成功 traduzido" }]);
    assert.equal(service.getLastEngine(), "openrouter");
    assert.deepEqual(service.getLastModelIssues(), []);
  });
});

test("OpenRouter service falls back across configured model list", async () => {
  const { OpenRouterService } = await bundleTsModule(path.join(repoRoot, "services/openRouterService.ts"));
  const originalKey = process.env.OPENROUTER_API_KEY;
  const calls = [];

  try {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    await withMockedFetch(async (setFetch) => {
      setFetch(async (_url, init) => {
        const body = JSON.parse(String(init.body));
        calls.push(body.model);
        if (body.model === "blocked-model") {
          return new Response(JSON.stringify({ error: { message: "blocked" } }), {
            status: 403,
            headers: { "Content-Type": "application/json" }
          });
        }
        return openRouterResponse(JSON.stringify({ records: [{ content: "Amostra concluída" }] }));
      });

      const service = new OpenRouterService("unused-default");
      const output = await service.translateBatch(
        [{ content: "样本完成" }],
        "Portuguese",
        { models: ["blocked-model", "qwen/qwen3.6-plus"] }
      );
      assert.deepEqual(calls, ["blocked-model", "qwen/qwen3.6-plus"]);
      assert.deepEqual(output, [{ content: "Amostra concluída" }]);
    });
  } finally {
    if (originalKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalKey;
    }
  }
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
      functionContext(
        {
          samples: [
            {
              id: "sample-1",
              location: "row 1",
              source: "白细胞升高",
              target: "White blood cells are high"
            }
          ],
          targetLang: "English",
          model: "deepseek:judge-model"
        },
        {
          DEEPSEEK_API_KEY: "test-deepseek-key"
        }
      )
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.engine, "deepseek");
    assert.equal(payload.model, "deepseek:judge-model");
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
      functionContext(
        {
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
          translationModels: ["deepseek:model-a", "deepseek:model-b"],
          judgeModels: ["deepseek:judge-a"],
          reviewStyle: "ifu-manual",
          profile: "docx-manual"
        },
        {
          DEEPSEEK_API_KEY: "test-deepseek-key"
        }
      )
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.concurrency, { translation: 2, judge: 1 });
    assert.deepEqual(seenModels.sort(), ["judge-a", "model-a", "model-b"].sort());
    assert.equal(payload.candidates.length, 2);
    assert.equal(payload.judges.length, 1);
    assert.equal(payload.ranking[0].alias, "Candidate A");
    assert.equal(payload.ranking[0].model, "deepseek:model-a");
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

test("TranslationHub splits DeepSeek Pro proxy overload failures before skipping a batch", async () => {
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
          return new Response(
            JSON.stringify({
              error: "All translation engines failed. deepseek-v4-pro: DeepSeek error 503: Server overloaded",
              modelIssues: [
                {
                  model: "deepseek-v4-pro",
                  status: 503,
                  message: "Server overloaded",
                  kind: "http"
                }
              ]
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" }
            }
          );
        }
        return new Response(
          JSON.stringify({
            engine: "deepseek",
            records: body.records.map((record) => ({
              ...record,
              content: `${record.content} traduit`
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
        targetLang: "French",
        options: { model: "deepseek", providerModel: "deepseek-v4-pro" }
      });
      assert.deepEqual(calls, [["A", "B"], ["A"], ["B"]]);
      assert.deepEqual(result, [{ content: "A traduit" }, { content: "B traduit" }]);
    });
  } finally {
    if (originalMode === undefined) {
      delete process.env.VITE_TRANSLATION_MODE;
    } else {
      process.env.VITE_TRANSLATION_MODE = originalMode;
    }
  }
});
