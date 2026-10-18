// Unit checks for the unified rule system: kept spans, retention policy, exceptions, retry convergence.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { annotateKeptSpans, getProseForLanguageCheck } from "../rules/spans.ts";
import { renderRetentionPolicyForPrompt, renderRetentionPolicyForReview } from "../rules/policy.ts";
import { runQualityChecksOnUnits } from "../quality/checks.ts";
import {
  acceptQualityException,
  clearQualityExceptions,
  listQualityExceptions,
  mergeRemoteQualityExceptions,
  removeQualityException,
  serializeExceptionsAsGoldenCases
} from "../quality/exceptions.ts";
import { noteRetryOutcome, resetRetryConvergence } from "../quality/retryConvergence.ts";
import { detectUntranslatedCells } from "../utils/language.ts";
import * as qaFeedbackApi from "../functions/api/qa-feedback.ts";
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

test("a confirmation covers only its own source text, stays listed as pending review, and can be undone", () => {
  clearQualityExceptions();
  const kept = "Display mode";
  acceptQualityException({ type: "nonTarget", targetLang: "Russian", sourceText: "显示模式", translatedText: kept });
  const report = check("Russian", "显示模式", kept);
  assert.equal(report.issues.nonTargetLanguage.length, 0);
  assert.equal(report.accepted.length, 1);
  assert.equal(report.accepted[0].pendingReview, true);
  // The same translation of a different sentence is still reported.
  assert.equal(check("Russian", "显示方式", kept).issues.nonTargetLanguage.length, 1);
  // A translated file checked on its own (no separate source) still honours the confirmation.
  assert.equal(check("Russian", kept, kept).issues.nonTargetLanguage.length, 0);
  // Undo: reported again.
  removeQualityException(listQualityExceptions()[0].key);
  assert.equal(check("Russian", "显示模式", kept).issues.nonTargetLanguage.length, 1);
  clearQualityExceptions();
});

test("an issue that does not fire does not count as a used confirmation", () => {
  clearQualityExceptions();
  acceptQualityException({ type: "nonTarget", targetLang: "Russian", sourceText: "显示模式", translatedText: "Режим отображения" });
  assert.equal(check("Russian", "显示模式", "Режим отображения").accepted.length, 0);
  clearQualityExceptions();
});

test("shared confirmations: the store wins, undo elsewhere removes, unsynced local entries are kept", () => {
  clearQualityExceptions();
  const local = acceptQualityException({ type: "nonTarget", targetLang: "Russian", sourceText: "显示模式", translatedText: "Display mode" });
  const remote = { ...acceptQualityException({ type: "spacing", targetLang: "Russian", sourceText: "a", translatedText: "b  c" }) };
  clearQualityExceptions();
  acceptQualityException(local);
  // Remote has one entry, already reviewed; the local one was never pushed.
  const unsynced = mergeRemoteQualityExceptions([{ ...remote, reviewStatus: "reviewed" }]);
  assert.deepEqual(unsynced.map((item) => item.key), [local.key]);
  assert.equal(listQualityExceptions().length, 2);
  assert.equal(listQualityExceptions().find((item) => item.key === remote.key).reviewStatus, "reviewed");
  // Undone on the other computer: the synced entry disappears here too.
  mergeRemoteQualityExceptions([]);
  assert.deepEqual(listQualityExceptions().map((item) => item.key), [local.key]);
  clearQualityExceptions();
});

test("qa-feedback endpoint stores, lists and deletes confirmations, and is off without the KV binding", async () => {
  const kv = new Map();
  const QA_FEEDBACK = {
    get: async (key) => kv.get(key) ?? null,
    put: async (key, value) => void kv.set(key, value),
    delete: async (key) => void kv.delete(key),
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true })
  };
  const env = { QA_FEEDBACK, REQUIRE_CF_ACCESS_EMAIL: "false" };
  const entry = { key: "nonTargetLanguage|russian|12-1k12q1o|4-131c6vj", type: "nonTargetLanguage", targetLang: "Russian", sourceText: "显示模式", translatedText: "Display mode" };
  const url = "https://example.test/api/qa-feedback";
  const post = await qaFeedbackApi.onRequestPost({ env, request: new Request(url, { method: "POST", body: JSON.stringify({ entry }) }) });
  assert.equal(post.status, 200);
  const listed = await (await qaFeedbackApi.onRequestGet({ env, request: new Request(url) })).json();
  assert.equal(listed.enabled, true);
  assert.equal(listed.entries[0].reviewStatus, "pending");
  const bad = await qaFeedbackApi.onRequestPost({ env, request: new Request(url, { method: "POST", body: JSON.stringify({ entry: { ...entry, key: "x" } }) }) });
  assert.equal(bad.status, 400);
  await qaFeedbackApi.onRequestDelete({ env, request: new Request(`${url}?key=${encodeURIComponent(entry.key)}`, { method: "DELETE" }) });
  assert.equal(kv.size, 0);
  const off = await (await qaFeedbackApi.onRequestGet({ env: { REQUIRE_CF_ACCESS_EMAIL: "false" }, request: new Request(url) })).json();
  assert.equal(off.enabled, false);
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

test("qa-feedback recomputes keys, keeps browser entries pending, guards other users' entries and pages the list", async () => {
  const kv = new Map();
  const QA_FEEDBACK = {
    get: async (key) => kv.get(key) ?? null,
    put: async (key, value) => void kv.set(key, value),
    delete: async (key) => void kv.delete(key),
    list: async ({ prefix, cursor, limit }) => {
      const names = [...kv.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = Number(cursor || 0);
      const end = start + limit;
      return { keys: names.slice(start, end).map((name) => ({ name })), list_complete: end >= names.length, cursor: String(end) };
    }
  };
  const url = "https://example.test/api/qa-feedback";
  const as = (email) => ({ QA_FEEDBACK, ALLOW_LOCAL_WITHOUT_ACCESS: "true", LOCAL_DEV_EMAIL: email });
  const post = (email, entry) =>
    qaFeedbackApi.onRequestPost({ env: as(email), request: new Request(url, { method: "POST", body: JSON.stringify({ entry }) }) });
  const accepted = acceptQualityException({
    type: "nonTargetLanguage",
    targetLang: "Russian",
    sourceText: "显示模式",
    translatedText: "Display mode"
  });
  clearQualityExceptions();

  // A key without the source hash, or one that does not match the texts, is refused.
  const [type, lang, translatedHash] = accepted.key.split("|");
  assert.equal((await post("a@example.com", { ...accepted, key: `${type}|${lang}|${translatedHash}` })).status, 400);
  assert.equal((await post("a@example.com", { ...accepted, sourceText: "其他句子" })).status, 400);

  // A browser cannot mark its own entry reviewed.
  assert.equal((await post("a@example.com", { ...accepted, reviewStatus: "reviewed" })).status, 200);
  const stored = JSON.parse(kv.get(`confirm:${accepted.key}`));
  assert.equal(stored.reviewStatus, "pending");
  assert.equal(stored.confirmedBy, "a@example.com");

  // Another user can neither replace nor delete it.
  assert.equal((await post("b@example.com", { ...accepted, locationLabel: "changed" })).status, 403);
  const del = (email) =>
    qaFeedbackApi.onRequestDelete({
      env: as(email),
      request: new Request(`${url}?key=${encodeURIComponent(accepted.key)}`, { method: "DELETE" })
    });
  assert.equal((await del("b@example.com")).status, 403);
  assert.equal(kv.size, 1);

  // Listing is paged: 250 entries come back in two pages.
  for (let index = 0; index < 249; index += 1) kv.set(`confirm:x|y|${index}-a|1-a`, JSON.stringify({ key: `x|y|${index}-a|1-a` }));
  const first = await (await qaFeedbackApi.onRequestGet({ env: as("a@example.com"), request: new Request(url) })).json();
  assert.equal(first.entries.length, 200);
  assert.equal(first.complete, false);
  const second = await (
    await qaFeedbackApi.onRequestGet({ env: as("a@example.com"), request: new Request(`${url}?cursor=${first.cursor}`) })
  ).json();
  assert.equal(second.entries.length, 50);
  assert.equal(second.complete, true);

  assert.equal((await del("a@example.com")).status, 200);
  assert.equal(kv.has(`confirm:${accepted.key}`), false);
});

test("a partial read of the shared store never deletes local confirmations", () => {
  clearQualityExceptions();
  const local = acceptQualityException({ type: "nonTargetLanguage", targetLang: "Russian", sourceText: "显示模式", translatedText: "Display mode" });
  mergeRemoteQualityExceptions([{ ...local }]);
  assert.equal(listQualityExceptions()[0].synced, true);
  mergeRemoteQualityExceptions([], { complete: false });
  assert.equal(listQualityExceptions().length, 1);
  mergeRemoteQualityExceptions([], { complete: true });
  assert.equal(listQualityExceptions().length, 0);
});
