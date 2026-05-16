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

const readme = `# local-data 使用规则

这个目录只存放本地文件、真实样本、调试包和问题材料。\`local-data/\` 已被 \`.gitignore\` 忽略，里面的原始文档和公司资料不会提交到 git。

## 最常用目录

- \`inbox/\`: 放准备测试或准备翻译的原始文件。
- \`done/\`: 放已经测试通过、暂时没有发现问题的文件或结果。
- \`failed/\`: 放测试失败、需要继续分析的文件或结果。
- \`issues/\`: 每一个具体问题建一个子文件夹，汇总说明、截图、调试包、回归样本和资产 JSON。
- \`debug-packages/\`: 放网页 Quality Report 导出的 Debug Package JSON。
- \`regression-jsonl/\`: 放网页导出的 Regression JSONL 临时文件，修复时再挑选追加到正式 fixture。
- \`issue-assets/\`: 放网页导出的 Asset JSON，用于后续转成翻译记忆、术语候选或 QA 规则候选。
- \`screenshots/\`: 放脱敏截图或录屏。

## issues/ 命名建议

\`issues/\` 是最重要的目录。建议每个问题一个子文件夹：

\`\`\`text
issues/2026-05-16-docx-russian-list-residual/
issues/2026-05-16-pdf-french-text-layer-empty/
issues/2026-05-16-excel-placeholder-broken/
\`\`\`

每个问题子文件夹建议包含：

\`\`\`text
README.md
debug-package.json
regression.jsonl
asset.json
screenshot.png
\`\`\`

## 推荐操作流程

1. 原始待测文件放到 \`inbox/\`。
2. 翻译后没问题的结果放到 \`done/\`。
3. 翻译后有问题的结果放到 \`failed/\`。
4. Debug Package 放到 \`debug-packages/\`。
5. Regression JSONL 放到 \`regression-jsonl/\`。
6. Asset JSON 放到 \`issue-assets/\`。
7. 脱敏截图放到 \`screenshots/\`。
8. 重要问题在 \`issues/\` 下建一个问题文件夹，把相关材料汇总进去。

## 注意

- 不要把原始敏感文档放进 GitHub Issue。
- 不要把 \`local-data/\` 里的真实文件提交到 git。
- 可以提交到 git 的，是脱敏后的 fixture、测试、规则、术语和文档。
- 如果不确定该放哪里，优先放到 \`issues/某个问题名/\`，并写一个 \`README.md\` 说明。
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
