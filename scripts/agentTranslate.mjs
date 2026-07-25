import { readFile } from "node:fs/promises";

try {
  const source = await readFile(new URL("../.env.local", import.meta.url), "utf8");
  source.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) return;
    const raw = match[2].trim();
    const value =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw.replace(/\s+#.*$/, "");
    process.env[match[1]] = value;
  });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

process.env.VITE_TRANSLATION_MODE = "direct";
await import("../agent/cli.ts");
