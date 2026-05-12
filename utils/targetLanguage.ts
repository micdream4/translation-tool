import type { TargetLanguage } from "../types";

export const TRADITIONAL_CHINESE_TAIWAN: TargetLanguage = "Traditional Chinese (Taiwan)";

export const TARGET_LANGUAGE_OPTIONS: TargetLanguage[] = [
  "Chinese",
  TRADITIONAL_CHINESE_TAIWAN,
  "English",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Turkish",
  "Russian",
  "Portuguese"
];

export const STRING_RESOURCE_TARGET_LANGS: TargetLanguage[] = [
  TRADITIONAL_CHINESE_TAIWAN,
  "English",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Turkish",
  "Russian",
  "Portuguese"
];

export const getTargetLanguageLabel = (targetLang?: TargetLanguage) =>
  String(targetLang || "") === TRADITIONAL_CHINESE_TAIWAN
    ? "Traditional Chinese (Taiwan) / 繁體中文（台灣）"
    : String(targetLang || "");

export const isTraditionalChineseTaiwanTarget = (targetLang?: TargetLanguage) =>
  String(targetLang || "").toLowerCase().includes("traditional chinese") ||
  String(targetLang || "").includes("繁體") ||
  String(targetLang || "").includes("臺灣") ||
  String(targetLang || "").includes("台灣");

export const getTargetLocaleInstruction = (targetLang: TargetLanguage) => {
  if (!isTraditionalChineseTaiwanTarget(targetLang)) return "";
  return `- Target locale is Traditional Chinese for Taiwan. Use natural Taiwanese Traditional Chinese medical/technical wording, not Simplified Chinese converted character-by-character.
- Use Taiwan-preferred wording where natural, e.g. 檢驗, 品質, 資訊, 啟用, 列印, 檢體, 血液常規/血球計數 as context requires.
- Use Traditional Chinese punctuation and phrasing. Avoid Mainland Simplified Chinese expressions such as 质量, 信息, 启用, 打印, 样本 when Taiwanese usage is more appropriate.
- Preserve protected terms, model names, codes, units, placeholders, and English abbreviations exactly.`;
};

