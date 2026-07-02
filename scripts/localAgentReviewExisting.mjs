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
    source: "",
    targetFile: "",
    target: "",
    reports: "local-data/agent/reports",
    reviewModel: "",
    reviewBatchSize: 20,
    ids: new Set()
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--source") options.source = readValue();
    else if (arg === "--translated" || arg === "--target-file") options.targetFile = readValue();
    else if (arg === "--target" || arg === "--lang") options.target = readValue();
    else if (arg === "--reports") options.reports = readValue();
    else if (arg === "--review-model") options.reviewModel = readValue();
    else if (arg === "--review-batch-size") options.reviewBatchSize = Number(readValue());
    else if (arg === "--ids") {
      options.ids = new Set(
        readValue()
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      );
    }
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  options.reviewBatchSize = Math.max(1, Math.floor(options.reviewBatchSize || 20));
  return options;
};

const usage = () => `
Usage:
  npm run agent:review -- --target French --source local-data/inbox/source.docx --translated local-data/agent/done/translated.docx
`;

const resolveRepoPath = (value) => path.resolve(repoRoot, value);

const parseEnvFile = async () => {
  try {
    const raw = await fs.readFile(resolveRepoPath(".env.local"), "utf8");
    return Object.fromEntries(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const [key, ...rest] = line.split("=");
          return [key.trim(), rest.join("=").trim().replace(/^['"]|['"]$/g, "")];
        })
    );
  } catch {
    return {};
  }
};

const loadEnv = async () => {
  const envFile = await parseEnvFile();
  Object.entries(envFile).forEach(([key, value]) => {
    if (process.env[key] === undefined) process.env[key] = value;
  });
  process.env.VITE_TRANSLATION_MODE ||= "direct";
};

const bundleTsModule = async (sourcePath) => {
  const tmpDir = await fs.mkdtemp(path.join(repoRoot, ".tmp-agent-review-bundle-"));
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
  const [docx, quality, sampleReview, postprocess, language, retryTargets] = await Promise.all([
    bundleTsModule(resolveRepoPath("utils/docx.ts")),
    bundleTsModule(resolveRepoPath("utils/quality.ts")),
    bundleTsModule(resolveRepoPath("services/sampleReviewAuditService.ts")),
    bundleTsModule(resolveRepoPath("utils/postprocess.ts")),
    bundleTsModule(resolveRepoPath("utils/language.ts")),
    bundleTsModule(resolveRepoPath("utils/retryTargets.ts"))
  ]);
  return {
    ...docx,
    ...quality,
    ...postprocess,
    ...language,
    ...retryTargets,
    SampleReviewAuditService: sampleReview.SampleReviewAuditService
  };
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

const normalizeReview = ({ sample, review, result, core, options }) => {
  const rawVerdict = review?.verdict || "warning";
  const suggestion = review?.suggestion || "";
  const polishedSuggestion = suggestion
    ? core.polishTranslation(sample.source, suggestion, options.target)
    : "";
  const suggestionMatchesTarget =
    suggestion &&
    normalizeComparableText(polishedSuggestion) === normalizeComparableText(sample.target);
  const verdict = rawVerdict !== "pass" && suggestionMatchesTarget ? "pass" : rawVerdict;
  return {
    ...sample,
    verdict,
    risk: verdict === "pass" ? "low" : review?.risk || "medium",
    issueTypes: verdict === "pass" ? [] : review?.issueTypes || ["review-missing"],
    comment:
      verdict === "pass" && suggestionMatchesTarget
        ? "AI 语义审查建议经本地后处理后与当前译文一致，视为已收敛。"
        : review?.comment || "AI 语义审查未返回该样本结果，需人工复核。",
    suggestion: verdict === "pass" && suggestionMatchesTarget ? "" : suggestion,
    model: result.model,
    engine: result.engine
  };
};

const reviewCandidates = async ({ candidates, options, core, reviewer }) => {
  const reviews = [];
  const errors = [];
  for (let i = 0; i < candidates.length; i += options.reviewBatchSize) {
    const batch = candidates.slice(i, i + options.reviewBatchSize);
    try {
      const result = await reviewer.reviewSamples(batch, options.target, options.reviewModel || undefined);
      const byId = new Map((result.reviews || []).map((item) => [item.id, item]));
      batch.forEach((sample) => {
        reviews.push(normalizeReview({ sample, review: byId.get(sample.id), result, core, options }));
      });
      console.log(`[semantic] reviewed ${Math.min(i + batch.length, candidates.length)}/${candidates.length} samples`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      batch.forEach((sample) => {
        reviews.push({
          ...sample,
          verdict: "warning",
          risk: "medium",
          issueTypes: ["review-error"],
          comment: "AI 语义审查调用失败，需人工复核。",
          suggestion: "",
          error: message
        });
      });
    }
  }
  const counts = reviews.reduce(
    (acc, item) => {
      acc[item.verdict] = (acc[item.verdict] || 0) + 1;
      return acc;
    },
    { pass: 0, warning: 0, fail: 0 }
  );
  return {
    mode: "full-existing",
    candidateCount: candidates.length,
    reviewedCount: reviews.length,
    counts,
    status: errors.length ? "review-error" : counts.fail > 0 ? "failed" : counts.warning > 0 ? "warning" : "passed",
    errors,
    reviews
  };
};

const buildCandidates = (sourceContext, targetContext, core, { lang, ids = new Set() }) => {
  const count = Math.min(sourceContext.segments.length, targetContext.segments.length);
  const candidates = [];
  const sourceRows = [];
  const targetRows = [];
  const mismatches = [];
  for (let index = 0; index < count; index += 1) {
    const sourceSegment = sourceContext.segments[index];
    const targetSegment = targetContext.segments[index];
    const source = sourceSegment.original;
    const target = core.getDocxSegmentText(targetSegment);
    sourceRows.push({ content: source });
    targetRows.push({ content: target });
    if (sourceSegment.partPath !== targetSegment.partPath) {
      mismatches.push({
        index,
        sourcePart: sourceSegment.partPath,
        targetPart: targetSegment.partPath
      });
    }
    if (!core.shouldTranslateCellValue("", source, lang, { ignoreLock: true })) continue;
    if (!String(source || "").trim() || !String(target || "").trim()) continue;
    const candidate = {
      id: sourceSegment.id,
      location: `${sourceSegment.partLabel}#${index + 1}`,
      source,
      target,
      length: source.length
    };
    if (!ids.size || ids.has(candidate.id)) candidates.push(candidate);
  }
  return {
    candidates,
    sourceRows,
    targetRows,
    mismatches,
    segmentCounts: {
      source: sourceContext.segments.length,
      target: targetContext.segments.length,
      paired: count
    }
  };
};

const writeReport = async ({ options, sourcePath, translatedPath, built, qualityReport, semanticReview }) => {
  const reportDir = resolveRepoPath(options.reports);
  await fs.mkdir(reportDir, { recursive: true });
  const suffix = options.ids.size ? `_selected_${options.ids.size}` : "";
  const base = `${path.basename(sourcePath, path.extname(sourcePath))}_existing_docx_${options.target}${suffix}`;
  const jsonPath = path.join(reportDir, `${base}.json`);
  const mdPath = path.join(reportDir, `${base}.md`);
  const report = {
    schema: "poct.local_agent_existing_translation_review.v1",
    createdAt: new Date().toISOString(),
    source: path.relative(repoRoot, sourcePath),
    translated: path.relative(repoRoot, translatedPath),
    targetLang: options.target,
    documentKind: "docx",
    segmentCounts: built.segmentCounts,
    partMismatches: built.mismatches,
    hardQa: qualityReport,
    semanticReview
  };
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
  const topIssues = semanticReview.reviews
    .filter((review) => review.verdict !== "pass")
    .slice(0, 50)
    .map((review) => `- ${review.location}: ${review.verdict}/${review.risk} ${review.issueTypes?.join(",") || ""} - ${review.comment}`);
  const lines = [
    `# Existing Translation Review - ${path.basename(sourcePath)}`,
    "",
    `- Target language: ${options.target}`,
    `- Source: ${path.relative(repoRoot, sourcePath)}`,
    `- Translated: ${path.relative(repoRoot, translatedPath)}`,
    `- Segments paired: ${built.segmentCounts.paired}/${built.segmentCounts.source}`,
    `- Hard QA Chinese cells: ${qualityReport.totals.chineseCells}`,
    `- Hard QA placeholder cells: ${qualityReport.totals.placeholderCells}`,
    `- Hard QA non-target cells: ${qualityReport.totals.nonTargetCells}`,
    `- Semantic status: ${semanticReview.status}`,
    `- Semantic reviewed: ${semanticReview.reviewedCount}/${semanticReview.candidateCount}`,
    `- Pass: ${semanticReview.counts.pass || 0}`,
    `- Warning: ${semanticReview.counts.warning || 0}`,
    `- Fail: ${semanticReview.counts.fail || 0}`,
    "",
    "## Top Semantic Issues",
    "",
    ...(topIssues.length ? topIssues : ["- None"])
  ];
  await fs.writeFile(mdPath, `${lines.join("\n")}\n`);
  return { jsonPath, mdPath };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.source || !options.targetFile || !options.target) {
    throw new Error("--source, --translated, and --target are required.");
  }
  await loadEnv();
  const core = await loadCore();
  const sourcePath = resolveRepoPath(options.source);
  const translatedPath = resolveRepoPath(options.targetFile);
  const [sourceContext, targetContext] = await Promise.all([
    readDocxContext(sourcePath, core),
    readDocxContext(translatedPath, core)
  ]);
  const built = buildCandidates(sourceContext, targetContext, core, {
    lang: options.target,
    ids: options.ids
  });
  const qualityReport = core.runQualityChecks(built.sourceRows, built.targetRows, {
    targetLang: options.target
  });
  const reviewer = new core.SampleReviewAuditService();
  const semanticReview = await reviewCandidates({
    candidates: built.candidates,
    options,
    core,
    reviewer
  });
  const paths = await writeReport({
    options,
    sourcePath,
    translatedPath,
    built,
    qualityReport,
    semanticReview
  });
  console.log(JSON.stringify({
    status: semanticReview.status,
    reviewed: semanticReview.reviewedCount,
    counts: semanticReview.counts,
    report: path.relative(repoRoot, paths.jsonPath)
  }, null, 2));
  if (semanticReview.status === "failed" || semanticReview.status === "review-error") {
    process.exitCode = 2;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
