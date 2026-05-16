import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const repoRoot = path.resolve(import.meta.dirname, "..");

const bundleTsModule = async (sourcePath) => {
  const tmpDir = fs.mkdtempSync(path.join(repoRoot, ".tmp-debug-regression-"));
  const outputPath = path.join(tmpDir, `${path.basename(sourcePath, ".ts")}.mjs`);
  try {
    await esbuild.build({
      entryPoints: [sourcePath],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      outfile: outputPath,
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

const parseArgs = (argv) => {
  const args = { input: "", output: "" };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if ((arg === "--input" || arg === "-i") && next) {
      args.input = next;
      index += 1;
    } else if ((arg === "--output" || arg === "-o") && next) {
      args.output = next;
      index += 1;
    }
  }
  if (!args.input) {
    throw new Error("Usage: node scripts/debugPackageToRegression.mjs --input <debug-package.json> [--output fixtures/translation-issue-regression.jsonl]");
  }
  return args;
};

const main = async () => {
  const args = parseArgs(process.argv);
  const inputPath = path.resolve(args.input);
  const debugPackage = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const { buildRegressionCasesFromDebugPackage, serializeRegressionCasesJsonl } = await bundleTsModule(
    path.join(repoRoot, "utils/regressionAssets.ts")
  );
  const cases = buildRegressionCasesFromDebugPackage(debugPackage);
  const jsonl = serializeRegressionCasesJsonl(cases);
  if (args.output) {
    const outputPath = path.resolve(args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, jsonl ? `${jsonl}\n` : "", "utf8");
    console.log(`Wrote ${cases.length} regression cases to ${path.relative(repoRoot, outputPath)}`);
  } else {
    process.stdout.write(jsonl ? `${jsonl}\n` : "");
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
