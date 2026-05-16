import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const localDataRoot = path.join(repoRoot, "local-data");

const directories = [
  "inbox",
  "issues",
  "debug-packages",
  "issue-assets",
  "regression-jsonl",
  "screenshots",
  "done",
  "failed"
];

const readme = `# Local Issue Workspace

This directory is ignored by git and is used for local translation issue capture.

Recommended flow:

1. Put files to test in \`inbox/\`.
2. Export Debug Package JSON to \`debug-packages/\`.
3. Export Asset JSON to \`issue-assets/\`.
4. Export Regression JSONL to \`regression-jsonl/\`.
5. Store desensitized screenshots in \`screenshots/\`.
6. Create one subdirectory per issue under \`issues/\`.

Do not commit original customer/company documents. Commit only reusable tests,
rules, glossary entries, or sanitized fixtures.
`;

fs.mkdirSync(localDataRoot, { recursive: true });
for (const directory of directories) {
  fs.mkdirSync(path.join(localDataRoot, directory), { recursive: true });
}

const readmePath = path.join(localDataRoot, "README.md");
if (!fs.existsSync(readmePath)) {
  fs.writeFileSync(readmePath, readme);
}

console.log(
  JSON.stringify(
    {
      schema: "poct.local_issue_workspace.v1",
      root: "local-data",
      directories
    },
    null,
    2
  )
);
