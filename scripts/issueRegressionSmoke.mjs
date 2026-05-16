import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const repoRoot = path.resolve(import.meta.dirname, "..");
const defaultFixture = path.join(repoRoot, "fixtures/translation-issue-regression.jsonl");

const bundleTsModule = async (sourcePath) => {
  const tmpDir = fs.mkdtempSync(path.join(repoRoot, ".tmp-issue-regression-"));
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

const main = async () => {
  const fixturePath = path.resolve(process.argv[2] || defaultFixture);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Regression fixture not found: ${fixturePath}`);
  }
  const { parseRegressionCasesJsonl, runRegressionCases } = await bundleTsModule(
    path.join(repoRoot, "utils/regressionAssets.ts")
  );
  const cases = parseRegressionCasesJsonl(fs.readFileSync(fixturePath, "utf8"));
  const result = runRegressionCases(cases);
  console.log(JSON.stringify({
    fixture: path.relative(repoRoot, fixturePath),
    total: result.total,
    passed: result.passed,
    failed: result.failed,
    failures: result.failures
  }, null, 2));
  if (result.failed > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
