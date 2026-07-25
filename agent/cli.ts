import path from "node:path";
import { runAgentTranslationTask } from "./taskRunner";
import type { AgentTaskOptions } from "./types";

const parseArguments = (argv: string[]): AgentTaskOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) {
      throw new Error(`无法识别的参数：${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`参数 ${key} 缺少值。`);
    }
    values.set(key.slice(2), value);
    index += 1;
  }

  const required = ["input", "output-dir", "report-dir", "task-id", "targets", "model"];
  const missing = required.filter((key) => !values.get(key)?.trim());
  if (missing.length) {
    throw new Error(`缺少必填参数：${missing.map((key) => `--${key}`).join(", ")}`);
  }

  return {
    inputPath: path.resolve(values.get("input")!),
    outputDir: path.resolve(values.get("output-dir")!),
    reportDir: path.resolve(values.get("report-dir")!),
    taskId: values.get("task-id")!.trim(),
    targets: values
      .get("targets")!
      .split(",")
      .map((target) => target.trim())
      .filter(Boolean),
    model: values.get("model")!.trim()
  };
};

const main = async () => {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await runAgentTranslationTask(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode =
      result.status === "FAILED" ? 1 : result.status === "BLOCKED" ? 2 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(
      `${JSON.stringify({
        schema: "poct.agent.translation-task.v1",
        taskId: null,
        status: "FAILED",
        readyForHumanReview: false,
        deliveryStatus: "BLOCKED",
        message
      })}\n`
    );
    process.exitCode = 1;
  }
};

await main();
