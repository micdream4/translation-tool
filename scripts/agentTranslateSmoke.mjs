import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Document, Packer, Paragraph, TextRun } from "docx";
import * as XLSX from "xlsx";
import "../agent/nodeRuntime.ts";
import { parseDocxFile } from "../utils/docx.ts";
import { runAgentTranslationTask } from "../agent/taskRunner.ts";

const translateText = (value) =>
  String(value)
    .replaceAll("白细胞", "leucocytes")
    .replaceAll("升高", "élevés")
    .replaceAll("状态", "état")
    .replaceAll("中文", "texte français")
    .replaceAll("[Product Name]", "[Nom du produit]")
    .replaceAll("Blood cell counting chamber", "Chambre de comptage des cellules sanguines")
    .replaceAll("Collect Sample", "Prélever l’échantillon");

const createProvider = ({ fail = false } = {}) => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async translate({ records }) {
      calls += 1;
      if (fail) throw new Error("synthetic model failure");
      return {
        engine: "fake-repository-router",
        records: records.map((record) =>
          Object.fromEntries(
            Object.entries(record).map(([key, value]) => [
              key,
              typeof value === "string" ? translateText(value) : value
            ])
          )
        )
      };
    }
  };
};

const createFixtureSet = async (root) => {
  const inputDir = path.join(root, "input");
  await mkdir(inputDir, { recursive: true });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["ID", "Code", "Description"],
      ["row-001", "WBC", "白细胞 WBC 升高"],
      ["row-003", "RBC", "[Product Name]"]
    ]),
    "Results"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["编号", "状态"],
      ["row-002", "中文状态"]
    ]),
    "Second"
  );
  const excelPath = path.join(inputDir, "sample.xlsx");
  XLSX.writeFile(workbook, excelPath);

  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun("白细胞 WBC 升高")]
          }),
          new Paragraph({
            children: [new TextRun("[Product Name]")]
          }),
          new Paragraph({
            children: [new TextRun("Blood cell counting chamber")]
          })
        ]
      }
    ]
  });
  const docxPath = path.join(inputDir, "sample.docx");
  await writeFile(docxPath, await Packer.toBuffer(document));

  const jsonPath = path.join(inputDir, "strings.json");
  await writeFile(
    jsonPath,
    `${JSON.stringify({
      status: "白细胞 WBC 升高",
      heading: "[Product Name]",
      nested: ["中文状态", "Collect Sample"]
    }, null, 2)}\n`,
    "utf8"
  );
  const xmlPath = path.join(inputDir, "strings.xml");
  await writeFile(
    xmlPath,
    '<resources>\n<string name="status">白细胞 WBC 升高 %s</string>\n<string name="heading">[Product Name]</string>\n</resources>\n',
    "utf8"
  );
  return { inputDir, excelPath, docxPath, jsonPath, xmlPath };
};

test("agent local command translates Excel, DOCX and string resources without overwriting input", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "poct-agent-success-"));
  const fixtures = await createFixtureSet(root);
  const outputDir = path.join(root, "output");
  const reportDir = path.join(root, "reports");
  const provider = createProvider();
  const sourceExcel = await readFile(fixtures.excelPath);
  const sourceDocx = await readFile(fixtures.docxPath);

  const result = await runAgentTranslationTask(
    {
      inputPath: fixtures.inputDir,
      outputDir,
      reportDir,
      taskId: "success-smoke",
      targets: ["French"],
      model: "deepseek-v4-pro"
    },
    { translationProvider: provider }
  );

  assert.equal(result.status, "COMPLETED");
  assert.equal(result.readyForHumanReview, true);
  assert.equal(result.deliveryStatus, "AWAITING_HUMAN_ACCEPTANCE");
  assert.equal(result.files.length, 4);
  assert.equal(result.outputFiles.length, 4);
  assert.ok(provider.calls > 0);
  assert.deepEqual(await readFile(fixtures.excelPath), sourceExcel);
  assert.deepEqual(await readFile(fixtures.docxPath), sourceDocx);

  const excelResult = result.files.find((file) => file.kind === "excel");
  assert.ok(excelResult?.outputPath);
  const translatedWorkbook = XLSX.read(await readFile(excelResult.outputPath), {
    type: "buffer"
  });
  assert.deepEqual(translatedWorkbook.SheetNames, ["Results", "Second"]);
  assert.equal(translatedWorkbook.Sheets.Results.A2.v, "row-001");
  assert.match(String(translatedWorkbook.Sheets.Results.C2.v), /leucocytes/);
  assert.equal(translatedWorkbook.Sheets.Results.C3.v, "[Nom du produit]");

  const docxResult = result.files.find((file) => file.kind === "docx");
  assert.ok(docxResult?.outputPath);
  const translatedDocx = await parseDocxFile(
    new File([await readFile(docxResult.outputPath)], "translated.docx")
  );
  assert.equal(translatedDocx.segments.length, 3);
  assert.match(translatedDocx.segments[0].original, /leucocytes/);
  assert.equal(translatedDocx.segments[1].original, "[Nom du produit]");
  assert.equal(
    translatedDocx.segments[2].original,
    "Chambre de comptage des cellules sanguines"
  );

  const jsonResult = result.files.find(
    (file) => file.inputPath === fixtures.jsonPath
  );
  assert.ok(jsonResult?.outputPath);
  const translatedJson = JSON.parse(await readFile(jsonResult.outputPath, "utf8"));
  assert.match(translatedJson.status, /leucocytes/);
  assert.equal(translatedJson.heading, "[Nom du produit]");
  assert.equal(translatedJson.nested[1], "Prélever l’échantillon");

  assert.equal(
    JSON.parse(await readFile(result.qualityReportPath, "utf8")).taskId,
    "success-smoke"
  );
});

test("agent local command reports model failures and does not publish partial output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "poct-agent-failure-"));
  const inputPath = path.join(root, "strings.json");
  await writeFile(inputPath, '{"status":"中文状态"}\n', "utf8");
  const provider = createProvider({ fail: true });
  const result = await runAgentTranslationTask(
    {
      inputPath,
      outputDir: path.join(root, "output"),
      reportDir: path.join(root, "reports"),
      taskId: "failure-smoke",
      targets: ["French"],
      model: "deepseek-v4-pro"
    },
    { translationProvider: provider }
  );

  assert.equal(result.status, "FAILED");
  assert.equal(result.readyForHumanReview, false);
  assert.equal(result.outputFiles.length, 0);
  assert.match(result.files[0].message, /synthetic model failure/);
});

test("agent master Quality Report includes every file-level failure with locations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "poct-agent-quality-summary-"));
  const inputPath = path.join(root, "strings.json");
  await writeFile(
    inputPath,
    `${JSON.stringify({
      heading: "Directions",
      action: "Collect Sample",
      manufacturer: "Manufacturer"
    })}\n`,
    "utf8"
  );
  const result = await runAgentTranslationTask(
    {
      inputPath,
      outputDir: path.join(root, "output"),
      reportDir: path.join(root, "reports"),
      taskId: "quality-summary-smoke",
      targets: ["French"],
      model: "deepseek-v4-pro"
    },
    {
      translationProvider: {
        async translate(request) {
          return { records: request.records, engine: "synthetic" };
        }
      }
    }
  );

  assert.equal(result.status, "BLOCKED");
  const masterReport = JSON.parse(await readFile(result.qualityReportPath, "utf8"));
  assert.equal(masterReport.files[0].failures.length, 3);
  assert.deepEqual(
    masterReport.files[0].failures.map((failure) => failure.type),
    ["nonTargetLanguage", "nonTargetLanguage", "nonTargetLanguage"]
  );
  assert.deepEqual(
    masterReport.files[0].failures.map((failure) => failure.rowIndex),
    [0, 1, 2]
  );
  assert.equal(
    masterReport.files[0].failures.length,
    Object.values(masterReport.files[0].issueCounts).reduce((sum, count) => sum + count, 0)
  );
});

test("agent local command returns BLOCKED for PDF before calling a model", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "poct-agent-blocked-"));
  const inputPath = path.join(root, "sample.pdf");
  await writeFile(inputPath, "%PDF-1.4\n%%EOF\n", "utf8");
  const provider = createProvider();
  const result = await runAgentTranslationTask(
    {
      inputPath,
      outputDir: path.join(root, "output"),
      reportDir: path.join(root, "reports"),
      taskId: "blocked-smoke",
      targets: ["French"],
      model: "deepseek-v4-pro"
    },
    { translationProvider: provider }
  );

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.readyForHumanReview, false);
  assert.equal(result.outputFiles.length, 0);
  assert.equal(provider.calls, 0);
  assert.match(result.files[0].message, /Canvas/);
});
