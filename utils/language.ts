import { POCTRecord, TargetLanguage } from "../types";
import {
  hasFrenchDiacriticRisk,
  hasProfileEnglishResidue,
  hasTargetDiacriticRisk,
  isRussianDisallowedLatinResidue
} from "./languageProfiles";
import { isTraditionalChineseTaiwanTarget } from "./targetLanguage";
import { isLikelyIdentifier, isProtectedTerm, stripProtectedTerms, stripPreservedUiLabels } from "./translationTokens";

export interface UntranslatedCell {
  rowIndex: number;
  columnKey: string;
  locationLabel?: string;
  value: string;
}

export interface DetectUntranslatedOptions {
  shouldIgnoreCell?: (rowIndex: number, columnKey: string, value: unknown) => boolean;
}

type LangCode = "zh" | "en" | "es" | "fr" | "de" | "it" | "pl" | "ro" | "pt" | "tr" | "ru" | "unknown";

const CJK_REGEX = /[\u4e00-\u9fff]/;
const CYRILLIC_REGEX = /[\u0400-\u04FF]/;
const LATIN_WORD_REGEX = /[A-Za-z\u00C0-\u024F]/;
const LATIN_TOKEN_REGEX = /\b[A-Za-z][A-Za-z0-9'-]{1,}\b/g;
const URL_REGEX = /\bhttps?:\/\/[^\s"'<>]+/gi;
const SHORT_CODE_REGEX = /^[A-Z0-9#%+_.\-\/]+$/;
const SYMBOL_ONLY_REGEX = /^[\s\-–—=+<>↑↓*·•.()（）【】[\]{}\\/]+$/;
const CODE_WITH_ARROW_REGEX = /^[A-Z]{1,6}[#%]?[↑↓]?$/
const TECHNICAL_LATIN_TEXT_REGEX = /^[A-Za-z0-9#%^+_.:/()[\]\-\s]+$/;
const TECHNICAL_SHORT_MARKER_REGEX = /^[A-Za-z]{1,8}[#%]$/;
const TECHNICAL_RATIO_TOKEN_REGEX = /^[A-Za-z]{1,8}(?:\/[A-Za-z0-9#%]+)+$/;
const TECHNICAL_UNDERSCORE_TOKEN_REGEX = /^[A-Z]{2,12}_\d{2,}$/;
const INTERNAL_STATUS_CODE_REGEX =
  /^(?:rbc|hgb|mcv|mch|mchc|ret|wbc|neu|lym|mon|eos|bas|aly|nsh|nst|srbc|awbc|malaria)-(?:up|down|normal|solo|combo|mixed)(?:-[a-z0-9]+)*$/i;
const DOT_COMPACT_NUMBER_REGEX = /^\d+(?:\.\d+)+[A-Za-z0-9/]*$/;
const ROMAN_REAGENT_CODE_REGEX = /^[A-Z]-[IVXLCDM]{1,8}$/;
const NUMERIC_UNIT_TEXT_REGEX = /^[\s\d.,×xX^+\-~–—/()％%μµA-Za-z]+$/;
const LATIN_UNIT_TOKEN_REGEX = /[A-Za-zμµ]+/g;
const LOCKED_KEY_REGEX = /(uuid|(^|[_\s-])id$|编号|序号|唯一标识)/i;
const ID_TOKEN_REGEX = /^(id|uuid)$/i;
const TAIWAN_SIMPLIFIED_RESIDUE_REGEX =
  /(质量|信息|启用|打印|样本|软件|硬件|默认|设置|数据|检测|检验结果|参数|菜单|窗口|上传|下载|文件|记录|审核|审查|运行|导出|导入|步骤|说明书|说明|错误|异常|提示|当前|完成|开始|暂停|恢复|细胞|白细胞|红细胞|血小板|中性粒|淋巴细胞|血红蛋白|计数|数量|浓度|范围|单位|用户|设备|仪器|厂商|条码|键盘|屏幕|连接|网络|服务器|数据库|登录|注册|密码|权限|质量控制|参考范围|临床|医疗)|[检测数质样设说译语误认读诊请项页风馆马验鱼鸟龙]/;

const LANGUAGE_HINTS: Record<Exclude<LangCode, "zh" | "ru" | "unknown">, string[]> = {
  en: [
    "a",
    "an",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "if",
    "is",
    "of",
    "on",
    "or",
    "that",
    "this",
    "the",
    "and",
    "to",
    "in",
    "with",
    "results",
    "patient",
    "blood",
    "cell",
    "cells",
    "normal",
    "test",
    "possible",
    "suggests",
    "increase",
    "decrease",
    "elevated",
    "indicates",
    "seen",
    "likely",
    "mild",
    "moderate",
    "severe"
  ],
  es: [
    "al",
    "como",
    "del",
    "el",
    "la",
    "los",
    "las",
    "de",
    "y",
    "en",
    "es",
    "para",
    "por",
    "que",
    "se",
    "sin",
    "son",
    "un",
    "una",
    "con",
    "resultado",
    "resultados",
    "paciente",
    "sangre",
    "celula",
    "celulas",
    "normal",
    "posible",
    "sugiere",
    "aumento",
    "disminucion",
    "elevado",
    "indica",
    "leve",
    "moderado",
    "grave"
  ],
  fr: [
    "un",
    "une",
    "du",
    "des",
    "dans",
    "est",
    "le",
    "la",
    "les",
    "de",
    "et",
    "en",
    "avec",
    "possible",
    "mais",
    "vers",
    "sur",
    "pour",
    "sans",
    "nombre",
    "total",
    "globules",
    "rouges",
    "hemoglobine",
    "anemie",
    "hemolytique",
    "hemolyse",
    "reticulocytes",
    "spherocytes",
    "defaut",
    "dommage",
    "structure",
    "membrane",
    "medicaments",
    "historique",
    "declencher",
    "presence",
    "reaction",
    "principale",
    "principalement",
    "orientant",
    "pointant",
    "elevee",
    "augmentation",
    "diminution",
    "synthese",
    "reserves",
    "insuffisantes",
    "suggere",
    "eleve",
    "indique",
    "leger",
    "modere",
    "grave"
  ],
  de: [
    "der",
    "die",
    "das",
    "und",
    "mit",
    "bei",
    "moeglich",
    "erhoeht",
    "zunahme",
    "abnahme",
    "weist",
    "leicht",
    "maessig",
    "schwer"
  ],
  it: [
    "il",
    "i",
    "la",
    "le",
    "lo",
    "gli",
    "un",
    "una",
    "di",
    "e",
    "o",
    "in",
    "con",
    "per",
    "che",
    "si",
    "non",
    "sono",
    "dei",
    "degli",
    "delle",
    "del",
    "della",
    "dello",
    "dell",
    "nel",
    "nella",
    "possibile",
    "possibili",
    "potrebbe",
    "possono",
    "suggerisce",
    "mostra",
    "mostrano",
    "risultati",
    "esame",
    "paziente",
    "sangue",
    "leucociti",
    "neutrofili",
    "linfociti",
    "monociti",
    "cellule",
    "infezione",
    "infiammazione",
    "infiammatorio",
    "infiammatoria",
    "ematologico",
    "ematologica",
    "midollo",
    "osseo",
    "organismo",
    "quadro",
    "processo",
    "reazione",
    "aumento",
    "diminuzione",
    "elevato",
    "riduzione",
    "ridotto",
    "diminuita",
    "diminuito",
    "indica",
    "indicando",
    "lieve",
    "moderato",
    "grave"
  ],
  pt: [
    "o",
    "a",
    "os",
    "as",
    "de",
    "e",
    "em",
    "com",
    "possivel",
    "sugere",
    "aumento",
    "diminuicao",
    "elevado",
    "indica",
    "leve",
    "moderado",
    "grave"
  ],
  pl: [
    "i",
    "oraz",
    "w",
    "we",
    "z",
    "ze",
    "na",
    "do",
    "dla",
    "jest",
    "sa",
    "są",
    "moze",
    "może",
    "mozliwe",
    "możliwe",
    "wynik",
    "wyniki",
    "badania",
    "pacjenta",
    "krew",
    "krwi",
    "komorka",
    "komórka",
    "komorki",
    "komórki",
    "zakazenie",
    "zakażenie",
    "wzrost",
    "spadek",
    "podwyzszony",
    "podwyższony",
    "obnizony",
    "obniżony",
    "wskazuje",
    "sugeruje",
    "lagodny",
    "łagodny",
    "umiarkowany",
    "ciezki",
    "ciężki"
  ],
  ro: [
    "si",
    "și",
    "in",
    "în",
    "cu",
    "pentru",
    "este",
    "sunt",
    "poate",
    "posibil",
    "rezultat",
    "rezultate",
    "pacient",
    "pacientului",
    "sange",
    "sânge",
    "celula",
    "celulă",
    "celule",
    "infectie",
    "infecție",
    "crestere",
    "creștere",
    "scadere",
    "scădere",
    "crescut",
    "scazut",
    "scăzut",
    "indica",
    "indică",
    "sugereaza",
    "sugerează",
    "usor",
    "ușor",
    "moderat",
    "sever"
  ],
  tr: [
    "ve",
    "ile",
    "bu",
    "bir",
    "olasi",
    "onerir",
    "artis",
    "azalis",
    "yuksek",
    "gosterir",
    "hafif",
    "orta",
    "agir"
  ]
};

const LANGUAGE_DIACRITICS: Record<
  Exclude<LangCode, "zh" | "ru" | "unknown">,
  RegExp
> = {
  // English has no distinctive diacritics; using a generic Latin regex here
  // biases nearly all Spanish/French/etc. text toward English.
  en: /$^/,
  es: /[ñáéíóúü¡¿]/i,
  fr: /[éèêëàâçîïôûùüÿœ]/i,
  de: /[äöüß]/i,
  it: /[àèéìòù]/i,
  pl: /[ąćęłńóśźż]/i,
  ro: /[ăâîșşțţ]/i,
  pt: /[ãõçáéíóúàâêô]/i,
  tr: /[çğıöşü]/i
};

const ALLOWED_NON_LATIN_TARGET_LATIN_TOKENS = new Set([
  "ai",
  "api",
  "alb",
  "aly",
  "awbc",
  "bas",
  "baso",
  "cmv",
  "crp",
  "csv",
  "dna",
  "doc",
  "docx",
  "ebv",
  "eos",
  "eosino",
  "esr",
  "hba1c",
  "hb",
  "hbsc",
  "hbss",
  "hct",
  "hgb",
  "hiv",
  "hplc",
  "html",
  "id",
  "ivd",
  "json",
  "lcd",
  "led",
  "lym",
  "mch",
  "mchc",
  "mcv",
  "mds",
  "mon",
  "mono",
  "mp",
  "mpv",
  "neu",
  "nsh",
  "nst",
  "pct",
  "pdw",
  "ph",
  "plasmodium",
  "plt",
  "pdf",
  "poct",
  "qc",
  "rna",
  "rbc",
  "rdw",
  "sle",
  "srbc",
  "th",
  "th1",
  "th2",
  "ui",
  "url",
  "usb",
  "wbc",
  "xml",
  "zip",
  "ac",
  "amd",
  "admin",
  "blood",
  "blo",
  "emc",
  "en",
  "enter",
  "ieee",
  "iec",
  "ipp",
  "ok",
  "ssid",
  "wi-fi",
  "cm",
  "dl",
  "fl",
  "g",
  "gb",
  "ghz",
  "hz",
  "kg",
  "kb",
  "l",
  "m",
  "mb",
  "mcg",
  "mg",
  "mhz",
  "min",
  "ml",
  "mm",
  "mmol",
  "ng",
  "pg",
  "rpm",
  "s",
  "sec",
  "ul",
  "v",
  "w"
]);

const normalizeLatin = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[μµ]/g, "u");

const tokenizeLatin = (text: string) =>
  normalizeLatin(text)
    .split(/[^a-z]+/g)
    .filter(Boolean);

const stripUrls = (text: string) => String(text || "").replace(URL_REGEX, " ").replace(/ {2,}/g, " ");

const scoreLanguage = (
  tokens: string[],
  hints: string[],
  hasDiacritics: boolean
) => {
  if (!tokens.length) return hasDiacritics ? 2 : 0;
  const set = new Set(hints);
  let score = hasDiacritics ? 2 : 0;
  tokens.forEach((token) => {
    if (set.has(token)) score += 1;
  });
  return score;
};

const getLanguageScores = (
  text: string
): Array<{ lang: Exclude<LangCode, "zh" | "ru" | "unknown">; score: number }> => {
  const tokens = tokenizeLatin(text);
  return (Object.keys(LANGUAGE_HINTS) as Array<
    Exclude<LangCode, "zh" | "ru" | "unknown">
  >)
    .map((lang) => ({
      lang,
      score: scoreLanguage(tokens, LANGUAGE_HINTS[lang], LANGUAGE_DIACRITICS[lang].test(text))
    }))
    .sort((a, b) => b.score - a.score);
};

const LATIN_TARGET_CODES: Array<Exclude<LangCode, "zh" | "ru" | "unknown">> = [
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pl",
  "ro",
  "pt",
  "tr"
];

const isLatinTargetCode = (
  code: LangCode
): code is Exclude<LangCode, "zh" | "ru" | "unknown"> =>
  LATIN_TARGET_CODES.includes(code as Exclude<LangCode, "zh" | "ru" | "unknown">);

const detectLanguage = (text: string): LangCode => {
  if (CJK_REGEX.test(text)) return "zh";
  if (CYRILLIC_REGEX.test(text)) return "ru";

  if (!LATIN_WORD_REGEX.test(text)) return "unknown";
  const scores = getLanguageScores(text);
  const best = scores[0];
  const second = scores[1];
  if (!best || best.score === 0) return "unknown";
  if (second && best.score === second.score) return "unknown";
  return best.lang;
};

const targetLangToCode = (targetLang: TargetLanguage): LangCode => {
  const normalized = String(targetLang || "").toLowerCase();
  if (normalized.includes("chinese")) return "zh";
  if (normalized.includes("english")) return "en";
  if (normalized.includes("spanish")) return "es";
  if (normalized.includes("french")) return "fr";
  if (normalized.includes("german")) return "de";
  if (normalized.includes("italian")) return "it";
  if (normalized.includes("polish")) return "pl";
  if (normalized.includes("romanian")) return "ro";
  if (normalized.includes("portuguese")) return "pt";
  if (normalized.includes("turkish")) return "tr";
  if (normalized.includes("russian")) return "ru";
  return "unknown";
};

export const hasSimplifiedChineseResidue = (text: string) =>
  TAIWAN_SIMPLIFIED_RESIDUE_REGEX.test(text);

const isAllowedLatinTokenInNonLatinTarget = (token: string) => {
  const normalized = normalizeLatin(token);
  if (!normalized) return true;
  if (ALLOWED_NON_LATIN_TARGET_LATIN_TOKENS.has(normalized)) return true;
  if (ROMAN_REAGENT_CODE_REGEX.test(token)) return true;
  if (isProtectedTerm(token) || isLikelyIdentifier(token)) return true;
  if (TECHNICAL_RATIO_TOKEN_REGEX.test(token)) return true;
  if (TECHNICAL_UNDERSCORE_TOKEN_REGEX.test(token)) return true;
  if (DOT_COMPACT_NUMBER_REGEX.test(token)) return true;
  if (/^[A-Z]{2,8}s?$/.test(token)) return true;
  if (/^(?=.*\d)[A-Za-z0-9-]{2,}$/.test(token)) return true;
  if (INTERNAL_STATUS_CODE_REGEX.test(token)) return true;
  if (/^[A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/.test(token)) return true;
  return false;
};

const isAllowedNumericUnitText = (text: string) => {
  const stripped = stripProtectedTerms(stripPreservedUiLabels(stripUrls(text))).trim();
  if (!stripped || !/\d/.test(stripped)) return false;
  if (!NUMERIC_UNIT_TEXT_REGEX.test(stripped)) return false;
  const unitTokens = stripped.match(LATIN_UNIT_TOKEN_REGEX) || [];
  return unitTokens.every(isAllowedLatinTokenInNonLatinTarget);
};

const isAllowedTechnicalLatinText = (text: string) => {
  const stripped = stripProtectedTerms(stripPreservedUiLabels(stripUrls(text))).trim();
  if (!stripped) return true;
  if (isAllowedNumericUnitText(stripped)) return true;
  if (TECHNICAL_SHORT_MARKER_REGEX.test(stripped)) return true;
  if (INTERNAL_STATUS_CODE_REGEX.test(stripped)) return true;
  if (!TECHNICAL_LATIN_TEXT_REGEX.test(stripped)) return false;
  const tokens = stripped.match(LATIN_TOKEN_REGEX) || [];
  if (!tokens.length) return true;
  return tokens.every(isAllowedLatinTokenInNonLatinTarget);
};

const hasDisallowedLatinResidue = (text: string, targetLang?: TargetLanguage) => {
  const tokens = stripUrls(text).match(LATIN_TOKEN_REGEX) || [];
  return tokens.some((token) => {
    if (targetLang && targetLangToCode(targetLang) === "ru" && isRussianDisallowedLatinResidue(token)) {
      return true;
    }
    return !isAllowedLatinTokenInNonLatinTarget(token);
  });
};

export const isLikelyTargetLanguage = (text: string, targetLang: TargetLanguage) => {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (SYMBOL_ONLY_REGEX.test(trimmed)) return true;
  if (CODE_WITH_ARROW_REGEX.test(trimmed)) return true;
  if (INTERNAL_STATUS_CODE_REGEX.test(trimmed)) return true;
  if (!LATIN_WORD_REGEX.test(trimmed) && !CJK_REGEX.test(trimmed) && !CYRILLIC_REGEX.test(trimmed)) {
    return true;
  }
  if (trimmed.length <= 6 && SHORT_CODE_REGEX.test(trimmed)) {
    return true;
  }
  if (isAllowedNumericUnitText(trimmed)) return true;

  const targetCode = targetLangToCode(targetLang);
  if (targetCode === "zh") {
    if (CYRILLIC_REGEX.test(trimmed)) return false;
    if (isTraditionalChineseTaiwanTarget(targetLang) && hasSimplifiedChineseResidue(trimmed)) return false;
    return CJK_REGEX.test(trimmed);
  }
  if (targetCode === "ru") {
    if (CJK_REGEX.test(trimmed)) return false;
    if (!CYRILLIC_REGEX.test(trimmed)) return isAllowedTechnicalLatinText(trimmed);
    return !hasDisallowedLatinResidue(trimmed, targetLang);
  }

  // For non-Chinese / non-Russian targets, any residual CJK/Cyrillic means not fully translated.
  if (CJK_REGEX.test(trimmed) || CYRILLIC_REGEX.test(trimmed)) {
    return false;
  }
  if (targetCode !== "en" && hasProfileEnglishResidue(trimmed, targetLang)) {
    return false;
  }
  if (targetCode === "fr" && hasFrenchDiacriticRisk(trimmed, targetLang)) {
    return false;
  }
  if (targetCode !== "en" && hasTargetDiacriticRisk(trimmed, targetLang)) {
    return false;
  }

  const scores = getLanguageScores(trimmed);
  const best = scores[0] || { lang: "en", score: 0 };
  const second = scores[1] || { lang: "en", score: 0 };
  const targetScore =
    isLatinTargetCode(targetCode)
      ? scores.find((item) => item.lang === targetCode)?.score || 0
      : 0;
  const targetHasDistinctiveDiacritics =
    isLatinTargetCode(targetCode) && LANGUAGE_DIACRITICS[targetCode].test(trimmed);

  if (best.score === 0) {
    if (targetCode === "en") {
      return !CJK_REGEX.test(trimmed) && !CYRILLIC_REGEX.test(trimmed);
    }
    return true;
  }

  if (best.lang === targetCode) return true;

  // For Latin-script target languages, prefer a conservative acceptance policy.
  // Medical prose in French/Spanish/Portuguese/Italian/German/Turkish shares too
  // much vocabulary to treat a small scoring edge as a real language mismatch.
  if (isLatinTargetCode(targetCode)) {
    if (targetHasDistinctiveDiacritics && targetScore >= 2) return true;
    if (targetScore >= Math.max(3, best.score - 2)) return true;
  }

  // Only flag clear non-target prose. Short or medically abbreviated Latin
  // strings are too ambiguous and should not trigger endless retry loops.
  const strongSignal = best.score >= 4 && best.score >= second.score + 2 && best.score >= targetScore + 3;
  if (strongSignal) return false;

  return true;
};

export const detectUntranslatedCells = (
  records: POCTRecord[],
  targetLang: TargetLanguage,
  options: DetectUntranslatedOptions = {}
): UntranslatedCell[] => {
  if (!records || records.length === 0) return [];

  const flagged: UntranslatedCell[] = [];
  records.forEach((row, rowIndex) => {
    Object.entries(row).forEach(([key, value]) => {
      if (options.shouldIgnoreCell?.(rowIndex, key, value)) return;
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (!trimmed) return;
      if (
        LOCKED_KEY_REGEX.test(key) ||
        ID_TOKEN_REGEX.test(trimmed) ||
        isNeutralToken(trimmed) ||
        isLikelyIdentifier(trimmed)
      ) {
        return;
      }
      if (!isLikelyTargetLanguage(trimmed, targetLang)) {
        flagged.push({ rowIndex, columnKey: key, value: trimmed });
      }
    });
  });

  return flagged;
};
export { detectLanguage, getLanguageScores };
export const isNeutralToken = (text: string) =>
  SYMBOL_ONLY_REGEX.test(text.trim()) ||
  CODE_WITH_ARROW_REGEX.test(text.trim()) ||
  (text.trim().length <= 6 && SHORT_CODE_REGEX.test(text.trim()));
