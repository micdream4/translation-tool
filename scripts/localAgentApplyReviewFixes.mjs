import fs from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
const repoRoot = path.resolve(import.meta.dirname, "..");
const NODE_BUILTIN_EXTERNALS = [
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`)
];

const parseArgs = (argv) => {
  const options = {
    report: "",
    translated: "",
    output: "",
    statuses: new Set(["fail", "warning"]),
    ids: new Set(),
    overrides: new Map(),
    includeLowRisk: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--report") options.report = readValue();
    else if (arg === "--translated" || arg === "--target-file") options.translated = readValue();
    else if (arg === "--output") options.output = readValue();
    else if (arg === "--statuses") {
      options.statuses = new Set(
        readValue()
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      );
    } else if (arg === "--ids") {
      options.ids = new Set(
        readValue()
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      );
    } else if (arg === "--overrides") {
      options.overridesPath = readValue();
    } else if (arg === "--include-low-risk") options.includeLowRisk = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
};

const usage = () => `
Usage:
  node scripts/localAgentApplyReviewFixes.mjs --report local-data/agent/reports/review.json --translated local-data/agent/done/file.docx --output local-data/agent/done/file.docx
`;

const resolveRepoPath = (value) => path.resolve(repoRoot, value);

const bundleTsModule = async (sourcePath) => {
  const tmpDir = await fs.mkdtemp(path.join(repoRoot, ".tmp-agent-apply-review-"));
  const outputPath = path.join(tmpDir, `${path.basename(sourcePath, ".ts")}.cjs`);
  try {
    await esbuild.build({
      entryPoints: [sourcePath],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      outfile: outputPath,
      external: [...NODE_BUILTIN_EXTERNALS, "jszip", "@xmldom/xmldom"],
      logLevel: "silent"
    });
    return require(outputPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
};

const loadCore = async () => {
  const [docx, postprocess] = await Promise.all([
    bundleTsModule(resolveRepoPath("utils/docx.ts")),
    bundleTsModule(resolveRepoPath("utils/postprocess.ts"))
  ]);
  return { ...docx, ...postprocess };
};

const toArrayBuffer = (buffer) =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

const readDocxContext = async (filePath, core) => {
  globalThis.DOMParser ||= DOMParser;
  globalThis.XMLSerializer ||= XMLSerializer;
  const bytes = await fs.readFile(filePath);
  return core.parseDocxFile({
    name: path.basename(filePath),
    arrayBuffer: async () => toArrayBuffer(bytes)
  });
};

const normalizeComparableText = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();

const getSegmentIndex = (id) => {
  const match = String(id || "").match(/^docx-segment-(\d+)$/);
  return match ? Number(match[1]) : -1;
};

const isSafeSuggestion = (review, currentTarget, suggestion) => {
  const source = String(review.source || "");
  const normalizedSuggestion = normalizeComparableText(suggestion);
  if (!normalizedSuggestion) return false;
  if (source.length >= 12 && normalizedSuggestion.length < 3) return false;
  if (currentTarget.length >= 80 && normalizedSuggestion.length < currentTarget.length * 0.45) {
    return false;
  }
  return true;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.report || !options.translated) {
    throw new Error("--report and --translated are required.");
  }
  const reportPath = resolveRepoPath(options.report);
  const translatedPath = resolveRepoPath(options.translated);
  const outputPath = resolveRepoPath(options.output || options.translated);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  if (options.overridesPath) {
    const overridesRaw = JSON.parse(await fs.readFile(resolveRepoPath(options.overridesPath), "utf8"));
    options.overrides = new Map(Object.entries(overridesRaw));
  }
  const reviews = report.semanticReview?.reviews || [];
  const core = await loadCore();
  const context = await readDocxContext(translatedPath, core);
  const applied = [];
  const skipped = [];

  for (const review of reviews) {
    if (options.ids.size && !options.ids.has(review.id)) continue;
    if (!options.statuses.has(review.verdict)) continue;
    if (!options.includeLowRisk && review.risk === "low") continue;
    const overrideSuggestion = options.overrides.get(review.id);
    if (!review.suggestion && !overrideSuggestion) {
      skipped.push({ id: review.id, reason: "empty-suggestion" });
      continue;
    }
    const segmentIndex = getSegmentIndex(review.id);
    const segment = context.segments[segmentIndex];
    if (!segment) {
      skipped.push({ id: review.id, reason: "missing-segment" });
      continue;
    }
    const currentTarget = core.getDocxSegmentText(segment);
    if (normalizeComparableText(currentTarget) !== normalizeComparableText(review.target)) {
      skipped.push({ id: review.id, reason: "target-changed" });
      continue;
    }
    const rawSuggestion = overrideSuggestion || review.suggestion;
    const polished = core.polishTranslation(review.source || "", rawSuggestion, report.targetLang || "French");
    if (!isSafeSuggestion(review, currentTarget, polished)) {
      skipped.push({ id: review.id, reason: "unsafe-suggestion" });
      continue;
    }
    core.setDocxSegmentText(segment, polished);
    applied.push({ id: review.id, location: review.location, verdict: review.verdict, risk: review.risk });
  }

  if (applied.length) {
    await fs.writeFile(outputPath, Buffer.from(await core.buildDocxTranslationBuffer(context)));
  }
  console.log(JSON.stringify({ output: path.relative(repoRoot, outputPath), applied, skipped }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
