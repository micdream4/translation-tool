// Pulls "confirmed as correct" clicks from the shared Cloudflare store (QA_FEEDBACK KV) and turns
// the ones not yet reviewed into rule golden candidates, so they can be checked before they join
// fixtures/rule-golden-captured.jsonl. Uses the wrangler login of this computer; nothing is sent
// anywhere else.
//
//   npm run qa-feedback:pull            write local-data/qa-feedback/candidates-<date>.jsonl
//   npm run qa-feedback:mark-reviewed   mark entries already in rule-golden-captured.jsonl as reviewed
//
// The namespace id comes from QA_FEEDBACK_NAMESPACE_ID or the QA_FEEDBACK binding in wrangler.toml.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { serializeExceptionsAsGoldenCases } from "../quality/exceptions.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const capturedPath = path.join(repoRoot, "fixtures/rule-golden-captured.jsonl");
const PREFIX = "confirm:";

const readNamespaceId = () => {
  if (process.env.QA_FEEDBACK_NAMESPACE_ID) return process.env.QA_FEEDBACK_NAMESPACE_ID.trim();
  const toml = fs.readFileSync(path.join(repoRoot, "wrangler.toml"), "utf8");
  const block = toml.split(/\[\[kv_namespaces\]\]/).slice(1).find((part) => /binding\s*=\s*"QA_FEEDBACK"/.test(part));
  const id = block?.match(/\bid\s*=\s*"([^"]+)"/)?.[1];
  if (!id) {
    throw new Error("QA_FEEDBACK namespace id not found: set QA_FEEDBACK_NAMESPACE_ID or add the binding to wrangler.toml.");
  }
  return id;
};

const wrangler = (args) =>
  execFileSync("npx", ["wrangler", ...args], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

const listEntries = (namespaceId) => {
  const keys = JSON.parse(wrangler(["kv", "key", "list", "--namespace-id", namespaceId, "--prefix", PREFIX, "--remote"]));
  return keys
    .map(({ name }) => {
      try {
        return JSON.parse(wrangler(["kv", "key", "get", name, "--namespace-id", namespaceId, "--remote"]));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

const readCapturedIds = () => {
  if (!fs.existsSync(capturedPath)) return new Set();
  return new Set(
    fs
      .readFileSync(capturedPath, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line).id)
  );
};

const toGoldenCases = (entries) =>
  serializeExceptionsAsGoldenCases(entries)
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const pull = () => {
  const entries = listEntries(readNamespaceId());
  const captured = readCapturedIds();
  const candidates = toGoldenCases(entries.filter((item) => item.reviewStatus !== "reviewed")).filter(
    (item) => !captured.has(item.id)
  );
  const outDir = path.join(repoRoot, "local-data/qa-feedback");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `candidates-${new Date().toISOString().slice(0, 10)}.jsonl`);
  fs.writeFileSync(outPath, candidates.map((item) => JSON.stringify(item)).join("\n") + (candidates.length ? "\n" : ""));
  console.log(`Shared confirmations: ${entries.length}; new candidates for review: ${candidates.length}`);
  console.log(`Written to ${path.relative(repoRoot, outPath)}`);
  console.log("Review each one; append the correct ones to fixtures/rule-golden-captured.jsonl, then run");
  console.log("npm run test:rule-golden and npm run qa-feedback:mark-reviewed.");
};

const markReviewed = () => {
  const namespaceId = readNamespaceId();
  const captured = readCapturedIds();
  let marked = 0;
  listEntries(namespaceId).forEach((entry) => {
    if (entry.reviewStatus === "reviewed") return;
    const [golden] = toGoldenCases([entry]);
    if (!golden || !captured.has(golden.id)) return;
    wrangler([
      "kv", "key", "put", `${PREFIX}${entry.key}`, JSON.stringify({ ...entry, reviewStatus: "reviewed" }),
      "--namespace-id", namespaceId, "--remote"
    ]);
    marked += 1;
  });
  console.log(`Marked ${marked} shared confirmations as reviewed.`);
};

const command = process.argv[2] || "pull";
if (command === "pull") pull();
else if (command === "mark-reviewed") markReviewed();
else {
  console.error(`Unknown command: ${command} (use pull or mark-reviewed)`);
  process.exit(1);
}
