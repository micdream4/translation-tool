// Unit checks for the unified rule system: kept spans, retention policy, exceptions, retry convergence.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { annotateKeptSpans, getProseForLanguageCheck } from "../rules/spans.ts";
import { renderRetentionPolicyForPrompt, renderRetentionPolicyForReview } from "../rules/policy.ts";
import { runQualityChecksOnUnits } from "../quality/checks.ts";
import { acceptQualityException, clearQualityExceptions, serializeExceptionsAsGoldenCases } from "../quality/exceptions.ts";
import { noteRetryOutcome, resetRetryConvergence } from "../quality/retryConvergence.ts";
import { detectUntranslatedCells } from "../utils/language.ts";
import { buildTranslationPrompt } from "../utils/translationProfiles.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");

const check = (targetLang, sourceText, translatedText, options = {}) =>
  runQualityChecksOnUnits(
    {
      rowsScanned: 1,
      units: [
        {
          rowIndex: 0,
          columnKey: "text",
          locationLabel: "t",
          originalValue: sourceText,
          translatedValue: translatedText,
          originalText: sourceText,
          translatedText,
          hasOriginal: true,
          hasTranslated: true
        }
      ]
    },
    { targetLang, ...options }
  );

test("kept spans cover entities, address blocks, contacts and codes but leave prose", () => {
  const text = "Производитель: Shenzhen Mindray Bio-Medical Electronics Co., Ltd., E-mail: service@ehome-health.com";
  const rules = annotateKeptSpans(text).map((span) => span.rule);
  assert.ok(rules.includes("legal-entity"));
  assert.ok(rules.includes("email"));
  assert.equal(getProseForLanguageCheck(text).replace(/[\s,]+$/, ""), "Производитель");
  assert.equal(
    getProseForLanguageCheck("Adresse : Room 301/401(II), No.3 Building, Liandong U Valley Industrial Park, No.32 Yulian Road, Changsha, Hunan, P.R. China"),
    "Adresse"
  );
  assert.equal(getProseForLanguageCheck("Press the power button to start the analyzer."), "Press the power button to start the analyzer.");
  assert.match(getProseForLanguageCheck("The Company recommends regular calibration."), /Company recommends/);
});

test("rule golden set has no regressions against its baseline", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/ruleGoldenEval.mjs"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(output, /No regressions vs baseline/);
});

test("retention policy is the same text in the translation prompt and the AI review prompt", () => {
  const prompt = buildTranslationPrompt([{ content: "地址：长沙市" }], "French", "spreadsheet");
  assert.ok(prompt.includes(renderRetentionPolicyForPrompt()));
  assert.ok(!prompt.includes('Translate address/common nouns such as "Room"'));
  assert.match(renderRetentionPolicyForReview(), /Address blocks/);
});

test("a confirmed-as-correct finding is not reported again by either entry point", () => {
  clearQualityExceptions();
  const text = "Display mode";
  assert.equal(check("Russian", text, text, {}).issues.nonTargetLanguage.length, 1);
  acceptQualityException({ type: "nonTarget", targetLang: "Russian", sourceText: text, translatedText: text });
  assert.equal(check("Russian", text, text).issues.nonTargetLanguage.length, 0);
  assert.equal(detectUntranslatedCells([{ text }], "Russian").length, 0);
  assert.equal(check("Russian", text, text, { ignoreExceptions: true }).issues.nonTargetLanguage.length, 1);
  assert.match(serializeExceptionsAsGoldenCases(), /"expect":"pass"/);
  clearQualityExceptions();
});

test("a segment that retries keep returning unchanged is downgraded and stops retrying", () => {
  resetRetryConvergence();
  const source = "Display mode";
  assert.equal(check("Russian", source, source).issues.nonTargetLanguage[0].severity, undefined);
  noteRetryOutcome("Russian", source, source, source);
  assert.equal(check("Russian", source, source).issues.nonTargetLanguage[0].severity, undefined);
  noteRetryOutcome("Russian", source, source, source);
  const issue = check("Russian", source, source).issues.nonTargetLanguage[0];
  assert.equal(issue.severity, "low");
  assert.equal(issue.reason, "retry-stuck");
  noteRetryOutcome("Russian", source, source, "Режим отображения");
  assert.equal(check("Russian", source, "Режим отображения").issues.nonTargetLanguage.length, 0);
  resetRetryConvergence();
});

test("French typography spaces are not spacing errors; real splits still are", () => {
  assert.equal(check("French", "Website: www.x.com", "Site web : www.x.com").issues.spacing.length, 0);
  assert.equal(check("Russian", "A4 printer", "Принтер A 4").issues.spacing.length, 1);
});
