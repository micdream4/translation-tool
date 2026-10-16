// Scores the quality-check rules against the rule golden set.
//   node --import tsx scripts/ruleGoldenEval.mjs                 -> report + compare with baseline
//   node --import tsx scripts/ruleGoldenEval.mjs --update-baseline
// A case that was correct in the baseline and is now wrong fails the run (exit 1).
// Both QA entry points are scored: the shared Quality Check Core and the Excel residue scan.
import fs from "node:fs";
import path from "node:path";
import { runQualityChecksOnUnits } from "../quality/checks.ts";
import { detectUntranslatedCells } from "../utils/language.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const caseFileArgs = process.argv.flatMap((arg, index, args) =>
  arg === "--case-file" && args[index + 1] ? [path.resolve(args[index + 1])] : []
);
const caseFiles = caseFileArgs.length
  ? caseFileArgs
  : [
      path.join(repoRoot, "fixtures/rule-golden.jsonl"),
      path.join(repoRoot, "fixtures/rule-golden-captured.jsonl")
    ];
const baselinePath = path.join(repoRoot, "fixtures/rule-golden-baseline.json");
const updateBaseline = process.argv.includes("--update-baseline");
const verbose = process.argv.includes("--verbose");

const RESIDUE_TYPES = new Set(["chinese", "nonTargetLanguage"]);

const loadCases = () =>
  caseFiles
    .filter((file) => fs.existsSync(file))
    .flatMap((file) =>
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    );

const coreFindings = (testCase) => {
  const unit = {
    rowIndex: 0,
    columnKey: testCase.columnKey || "text",
    locationLabel: testCase.id,
    originalValue: testCase.sourceText,
    translatedValue: testCase.translatedText,
    originalText: testCase.sourceText,
    translatedText: testCase.translatedText,
    hasOriginal: true,
    hasTranslated: true
  };
  const report = runQualityChecksOnUnits({ rowsScanned: 1, units: [unit] }, { targetLang: testCase.targetLang, ignoreExceptions: true });
  return Object.entries(report.issues)
    .filter(([, items]) => items.some((item) => (item.severity || "error") !== "info"))
    .map(([type]) => type);
};

const excelResidue = (testCase) =>
  detectUntranslatedCells([{ [testCase.columnKey || "text"]: testCase.translatedText }], testCase.targetLang, {
    sourceRecords: [{ [testCase.columnKey || "text"]: testCase.sourceText }],
    ignoreExceptions: true
  }).length > 0;

const judge = (testCase) => {
  const types = coreFindings(testCase);
  const excel = excelResidue(testCase);
  if (testCase.expect === "either") return { verdict: "unscored", types, excel };
  if (testCase.expect === "pass") {
    const coreOk = types.length === 0;
    const excelOk = !excel;
    return { verdict: coreOk && excelOk ? "ok" : "falsePositive", types, excel, coreOk, excelOk };
  }
  const expected = testCase.expectTypes || [];
  const coreOk = expected.some((type) => types.includes(type));
  const needsExcel = expected.some((type) => RESIDUE_TYPES.has(type));
  const excelOk = needsExcel ? excel : true;
  return { verdict: coreOk && excelOk ? "ok" : "falseNegative", types, excel, coreOk, excelOk };
};

const cases = loadCases();
const results = {};
const totals = { cases: 0, ok: 0, falsePositive: 0, falseNegative: 0, unscored: 0 };
const byCategory = {};
cases.forEach((testCase) => {
  const result = judge(testCase);
  results[testCase.id] = result.verdict;
  totals.cases += 1;
  totals[result.verdict] += 1;
  const bucket = (byCategory[testCase.category] ||= { ok: 0, falsePositive: 0, falseNegative: 0, unscored: 0 });
  bucket[result.verdict] += 1;
  if (verbose && result.verdict !== "ok" && result.verdict !== "unscored") {
    console.log(`  ${result.verdict.padEnd(13)} ${testCase.id} core=[${result.types.join(",")}] excel=${result.excel} | ${testCase.translatedText.slice(0, 80)}`);
  }
});

console.log(`Rule golden set: ${totals.cases} cases`);
console.log(`  correct=${totals.ok} falsePositive=${totals.falsePositive} falseNegative=${totals.falseNegative} unscored=${totals.unscored}`);
Object.entries(byCategory)
  .sort(([a], [b]) => a.localeCompare(b))
  .forEach(([category, bucket]) => {
    console.log(`  ${category.padEnd(22)} ok=${bucket.ok} FP=${bucket.falsePositive} FN=${bucket.falseNegative}${bucket.unscored ? ` unscored=${bucket.unscored}` : ""}`);
  });

if (updateBaseline) {
  fs.writeFileSync(baselinePath, JSON.stringify({ totals, results }, null, 2) + "\n");
  console.log(`Baseline written to ${path.relative(repoRoot, baselinePath)}`);
  process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
  console.log("No baseline yet; run with --update-baseline.");
  process.exit(0);
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const regressions = Object.entries(results).filter(([id, verdict]) => baseline.results[id] === "ok" && verdict !== "ok" && verdict !== "unscored");
const improvements = Object.entries(results).filter(([id, verdict]) => baseline.results[id] && baseline.results[id] !== "ok" && verdict === "ok");
const currentFailures = Object.entries(results).filter(([, verdict]) => verdict === "falsePositive" || verdict === "falseNegative");
if (improvements.length) console.log(`Improved vs baseline: ${improvements.length} (run --update-baseline to lock in)`);
if (currentFailures.length) {
  console.error(`CURRENT GOLDEN FAILURES: ${currentFailures.length}`);
  currentFailures.forEach(([id, verdict]) => console.error(`  ${id}: ${verdict}`));
  process.exit(1);
}
if (regressions.length) {
  console.error(`REGRESSIONS vs baseline: ${regressions.length}`);
  regressions.forEach(([id, verdict]) => console.error(`  ${id}: ok -> ${verdict}`));
  process.exit(1);
}
console.log("No regressions vs baseline.");
