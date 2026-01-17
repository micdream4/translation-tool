import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";

const [argFile, argLang, argLimit] = process.argv.slice(2);
const filePath = path.resolve(argFile || "白细胞正常_test.xlsx");
const targetLanguage = argLang || "English";
const rowLimit = Number(argLimit ?? 0);

const parseEnvFile = async () => {
  try {
    const content = await fs.readFile(path.resolve(".env.local"), "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .reduce<Record<string, string>>((acc, line) => {
        const [key, ...rest] = line.split("=");
        acc[key.trim()] = rest.join("=").trim();
        return acc;
      }, {});
  } catch {
    return {};
  }
};

const envFromFile = await parseEnvFile();
const apiKey =
  process.env.VITE_DEEPSEEK_API_KEY ||
  process.env.Deepseek_API_KEY ||
  process.env.DEEPSEEK_API_KEY ||
  envFromFile.VITE_DEEPSEEK_API_KEY ||
  envFromFile.Deepseek_API_KEY ||
  envFromFile.DEEPSEEK_API_KEY;

if (!apiKey) {
  console.error("Missing Deepseek API key. Set VITE_DEEPSEEK_API_KEY or Deepseek_API_KEY in .env.local.");
  process.exit(1);
}

const workbook = XLSX.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const allRows = XLSX.utils.sheet_to_json(sheet);
const rows =
  rowLimit && rowLimit > 0 ? allRows.slice(0, rowLimit) : allRows;

console.log(
  `Processing ${rows.length} rows from sheet "${sheetName}" using Deepseek model...`
);

const prompt = `
You are a POCT medical spreadsheet translator. Translate every string to ${targetLanguage}.
Keep IDs/codes/numbers unchanged. Return only a JSON array preserving keys and row order.

INPUT:
${JSON.stringify(rows)}
`;

const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`
  },
  body: JSON.stringify({
    model: "deepseek-chat",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You accurately translate structured hematology/POCT tables and always answer with valid JSON."
      },
      { role: "user", content: prompt }
    ]
  })
});

if (!response.ok) {
  const errorText = await response.text();
  console.error("Deepseek API error:", response.status, errorText);
  process.exit(1);
}

const result = await response.json();
const rawContent =
  result.choices?.[0]?.message?.content?.replace(/```json|```/g, "").trim() ||
  "";

if (!rawContent) {
  console.error("Deepseek response is empty.");
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(rawContent);
} catch (err) {
  console.error("Failed to parse Deepseek JSON:", err);
  console.error("Raw content:", rawContent);
  process.exit(1);
}

const outputPath = path.resolve("deepseek_translation_preview.json");
await fs.writeFile(outputPath, JSON.stringify(parsed, null, 2), "utf8");

console.log(`Translation finished. Preview saved to ${outputPath}`);
console.log("Sample row:", parsed[0]);
