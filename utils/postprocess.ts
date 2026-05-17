import { enforceGlossary } from "./glossary";
import { enforceSeedTerminology } from "./seedTerminology";
import type { TargetLanguage } from "../types";

const LATIN_CHAR_REGEX = /[A-Za-z]/;
const NEWLINE_CAPTURE = /(\r?\n)/;
const LONG_FORM_THRESHOLD = 60;
const UI_MARKER_REGEX =
  /([『「“"'《【\[«])\s*([A-Za-z][A-Za-z0-9 _\-\/]{0,30})\s*([』」”"'》】\]»])/g;
const EN_WORD_GLUE_REGEX =
  /\b(on|in|to|for|with|by|of|and|or|the)(analyzer|interface|page|operation|maintenance|consumables|sample|collection|prepare|complete|range|work|itself|safety|manual|service|procedure)\b/gi;
const EN_EXACT_TOKEN_FIXES: Array<[RegExp, string]> = [
  [/\bdisassemblethe\b/gi, "disassemble the"],
  [/\bnecessary,\s*Wearprotective\b/g, "necessary, Wear protective"],
  [/\bWearprotective\b/g, "Wear protective"],
  [/\bGerman,French\b/g, "German, French"],
  [/\bCellsAnalysis\b/g, "Cells Analysis"],
  [/\bImmunochromatographyThe\b/g, "Immunochromatography The"],
  [/\bInterface:Analyzer\b/g, "Interface: Analyzer"],
  [/\bandperformmaintenance\b/gi, "and perform maintenance"],
  [/\bSupplyRequirements\b/g, "Supply Requirements"],
  [/\bConnectthe\b/g, "Connect the"],
  [/\bintothe\b/gi, "into the"],
  [/\bdCpowerinterface\b/g, "DC power interface"],
  [/\bCompositionDescription\b/g, "Composition Description"],
  [/\bRoutineImaging\b/g, "Routine Imaging"],
  [/\bFluorescenceImage\b/g, "Fluorescence Image"],
  [/\binstalled,setthe\b/gi, "installed, set the"],
  [/\bpowerswitchto\b/gi, "power switch to"],
  [/\btostart\b/gi, "to start"],
  [/\b1\.3\.3Fluorescence\b/g, "1.3.3 Fluorescence"],
  [/\b1\.5Cybersecurity\b/g, "1.5 Cybersecurity"],
  [/\bA 4 Printer\b/g, "A4 Printer"],
  [/\bA 4\b/g, "A4"],
  [/\bIPP printer\b/g, "IPP printer"],
  [/\bAnalyzer dCpowerinterface\b/g, "Analyzer DC power interface"],
  [/\bDCPower Interface\b/g, "DC Power Interface"],
  [/\bDCInterface\b/g, "DC Interface"],
  [/\bUSBInterface\b/g, "USB Interface"],
  [/\busesLEDlight\b/g, "uses LED light"],
  [/\bwithGB\/T\b/g, "with GB/T"],
  [/\bandGB\/T\b/g, "and GB/T"],
  [/\bprovidesUSBinterface\b/g, "provides USB interface"],
  [/\bwithTCP\/IPprotocol\b/g, "with TCP/IP protocol"],
  [/\btheDCpower\b/g, "the DC power"],
  [/\bCBCDetection\b/g, "CBC Detection"],
  [/\bCBCSingle\b/g, "CBC Single"],
  [/\bdisplayWBC\b/g, "display WBC"],
  [/\btheRBCvolume\b/g, "the RBC volume"],
  [/\bRBCVolume\b/g, "RBC Volume"],
  [/\bCBCThe\b/g, "CBC The"],
  [/\bCBCWill\b/g, "CBC Will"],
  [/\bCBCtest\b/g, "CBC test"],
  [/\busesCBCtest\b/g, "uses CBC test"],
  [/\bPLTthe\b/g, "PLT the"],
  [/\bPLTvolume\b/g, "PLT volume"],
  [/\bPLTcell\b/g, "PLT cell"],
  [/\bAIAnalysis\b/g, "AI Analysis"],
  [/\bRETand\b/g, "RET and"],
  [/\bforCBC QC\b/g, "for CBC QC"],
  [/\binstrumentUSBinterface\b/g, "instrument USB interface"],
  [/\baUUSB\b/g, "a USB"],
  [/\btheUUSB\b/g, "the USB"],
  [/\bcontainsImage\b/g, "contains image"],
  [/\bUdisk\b/g, "U disk"],
  [/\btheCBCunit\b/g, "the CBC unit"],
  [/\bneededCBCthe\b/g, "needed CBC the"],
  [/\btheCBCDefault\/Adult\b/g, "the CBC Default/Adult"],
  [/\btheCBCcalibration\b/g, "the CBC calibration"],
  [/\btheCBCfive\b/g, "the CBC five"],
  [/\btheWBC\b/g, "the WBC"],
  [/\btheCBCdetection\b/g, "the CBC detection"],
  [/\bCBCEnhanced\b/g, "CBC Enhanced"],
  [/\bCBCTesting\b/g, "CBC Testing"],
  [/\bPLTFocusing\b/g, "PLT Focusing"]
];
const RUSSIAN_RESIDUE_FIXES: Array<[RegExp, string]> = [
  [/\b(\d+)-year\b/gi, "$1 год"],
  [/(^|[\s(])в формате\s+(24|12)-hour\b/gi, "$1в $2-часовом формате"],
  [/\b(\d{1,2})-hour\b/gi, "$1-часовой"],
  [/\bList\b/g, "Список"],
  [/\blist\b/g, "список"],
  [/\bHome\b/g, "Главная"],
  [/\bOrders\b/g, "Заказы"],
  [/\bReports\b/g, "Отчеты"],
  [/\bReferences\b/g, "Справочные сведения"],
  [/\bProceed\b/g, "Продолжайте"],
  [/\bdevice\b/gi, "устройства"],
  [/\bsuccessful\b/gi, "успешного"],
  [/\baccess\b/gi, "доступа"],
  [/\bservices\b/gi, "службы"],
  [/\bservice\b/gi, "обслуживание"],
  [/\breference\b/gi, "справка"],
  [/\bsample\b/gi, "образец"],
  [/\bresult\b/gi, "результат"],
  [/\bresults\b/gi, "результаты"],
  [/\baccount management\b/gi, "управление учетными записями"],
  [/\binstrument SN\b/g, "серийный номер прибора"],
  [/\binstrument\b/gi, "прибор"],
  [/\bentry\b/gi, "запись"],
  [/\bConfirm\b/g, "Подтвердить"],
  [/\bCancel\b/g, "Отмена"],
  [/\bSave\b/g, "Сохранить"],
  [/\banalysis\b/gi, "анализ"],
  [/\bBuilding\b/g, "здание"],
  [/\bStreet\b/g, "улица"],
  [/\bDistrict\b/g, "район"],
  [/\bCity\b/g, "город"],
  [/\bProvince\b/g, "провинция"],
  [/\bfeces\b/gi, "фекалий"],
  [/\buncertain\b/gi, "неопределенным"],
  [/\bestablish\b/gi, "установить"],
  [/\bref(?=[\u0400-\u04FF])/gi, ""],
  [/\bWhite Blood Cell Count\b/g, "Количество лейкоцитов"],
  [/\bСрок\s+service\s+службы\b/gi, "Срок службы"]
];
const RUSSIAN_MODEL_ARTIFACT_FIXES: Array<[RegExp, string]> = [
  [/повыceет/g, "повышает"],
  [/сниceет/g, "снижает"],
  [/каceа/g, "кала"],
  [/обраceтки/g, "обработки"],
  [/запceсти/g, "запчасти"],
  [/технenском/g, "техническом"],
  [/обслужce/g, "обслуживании"],
  [/оборудenем/g, "оборудованием"],
  [/компонenтов/g, "компонентов"],
  [/принceдлежностей/g, "принадлежностей"],
  [/обслужenживceние/g, "обслуживание"],
  [/отмceнить/g, "отменить"],
  [/отceнить/g, "отменить"],
  [/полуceить/g, "получить"],
  [/перceйти/g, "перейти"],
  [/откenрыть/g, "открыть"],
  [/вкenлючить/g, "включить"],
  [/управлеenния/g, "управления"],
  [/воenти/g, "войти"],
  [/размеceениen/g, "размещения"],
  [/перейceи/g, "перейти"],
  [/Коenда/g, "Когда"],
  [/регeнты/g, "реагенты"],
  [/реагеenнты/g, "реагенты"],
  [/затеen/g, "затем"],
  [/обработкce/g, "обработку"],
  [/отenыть/g, "открыть"],
  [/ВвеEnте/g, "Введите"],
  [/нажмите En Enter/g, "нажмите Enter"],
  [/нажмите En /g, "нажмите "],
  [/измерenия/g, "измерения"],
  [/Обenие/g, "Общие"],
  [/требовenия/g, "требования"],
  [/оборудовenию/g, "оборудованию"],
  [/управлenия/g, "управления"],
  [/проceсс/g, "процесс"],
  [/обраzcess/g, "образца"],
  [/образцаcess/g, "образца"],
  [/DCce\b/g, "DC"],
  [/запись запись/g, "запись"],
  [/Запись запись/g, "Запись"],
  [/доceтупа/g, "доступа"],
  [/устройстce/g, "устройство"],
  [/обслceживания/g, "обслуживания"],
  [/сервиceной/g, "сервисной"],
  [/сервиceному/g, "сервисному"],
  [/сервиce/g, "сервис"],
  [/клаceте/g, "кладите"],
  [/спиlisку/g, "списку"],
  [/спиlisке/g, "списке"],
  [/спиlisок/g, "список"],
  [/\blis\b/g, "списке"],
  [/\s*\(ce\)/g, ""],
  [/([\u0400-\u04FF])\s+ce\b/g, "$1"]
];
const ANALYZER_PREFIX_WORDS = [
  "after",
  "and",
  "away",
  "before",
  "by",
  "cause",
  "clean",
  "disassemble",
  "exceeds",
  "for",
  "from",
  "in",
  "into",
  "not",
  "notice",
  "of",
  "on",
  "onto",
  "or",
  "order",
  "the",
  "this",
  "to",
  "with"
] as const;
const ANALYZER_SUFFIX_WORDS = [
  "all",
  "any",
  "clean",
  "damage",
  "dcpowerinterface",
  "faults",
  "for",
  "housing",
  "interface",
  "is",
  "itself",
  "manual",
  "maintenance",
  "operation",
  "operations",
  "operational",
  "outer",
  "parts",
  "placed",
  "power",
  "powerswitch",
  "procedure",
  "procedures",
  "provides",
  "range",
  "rear",
  "reported",
  "requirements",
  "residual",
  "safety",
  "serial",
  "specified",
  "standard",
  "the",
  "when",
  "work"
] as const;
const ANALYZER_PREFIX_REGEX = new RegExp(
  `\\b(${ANALYZER_PREFIX_WORDS.join("|")})(analyzer)(?=\\b|[A-Za-z])`,
  "gi"
);
const ANALYZER_SUFFIX_REGEX = new RegExp(
  `\\b(analyzer)(${ANALYZER_SUFFIX_WORDS.join("|")})\\b`,
  "gi"
);
const ANALYZER_LOWERCASE_LEFT_REGEX = new RegExp(
  `\\b(${ANALYZER_PREFIX_WORDS.join("|")})\\s+Analyzer\\b`,
  "g"
);

const lowerFirst = (value: string) => {
  if (!value) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
};

const fixSegmentSpacing = (segment: string) => {
  let result = segment;
  for (let i = 0; i < 4; i += 1) {
    const compacted = result.replace(/\b(\d+(?:\.\d+)*)\.\s+(\d+)(?=(?:\.|\b))/g, "$1.$2");
    if (compacted === result) break;
    result = compacted;
  }
  result = result.replace(/\bCo\.\s*,\s*Ltd\.\s*\./g, "Co., Ltd.");
  result = result.replace(/\bCo\.\s*,\s*Ltd\./g, "Co., Ltd.");
  result = result.replace(/\bEHB\s+T-75\b/g, "EHBT-75");
  result = result.replace(/\bozellemed\.\s+com\b/g, "ozellemed.com");
  result = result.replace(/\[\s*\.\s*\.\s*\.\s*\]/g, "[...]");
  result = result.replace(/\bIEEE\s+802\.\s+11\s*/g, "IEEE 802.11");
  result = result.replace(/\bA\s+4\b/g, "A4");
  result = result.replace(/\bA\s+1\b/g, "A1");
  result = result.replace(/\bAMD\s+1\b/g, "AMD1");
  result = result.replace(/\b([eE])\s*\.\s*g\s*\./g, (_match, initial) => {
    return `${initial}.g.`;
  });
  result = result.replace(/\s+([,.;:!?])/g, "$1");
  result = result.replace(/([,.;!?])(?![\s"')\]\}\d])/g, "$1 ");
  result = result.replace(/:(?!\/\/)(?![\s"')\]\}])/g, ": ");
  result = result.replace(/([.!?])([A-Z])/g, "$1 $2");
  result = result.replace(/([a-z])([A-Z][a-z])/g, "$1 $2");
  result = result.replace(/([0-9])([A-Za-z])/g, "$1 $2");
  result = result.replace(/([A-Za-z])([0-9])/g, "$1 $2");
  result = result.replace(/ {2,}/g, (match, offset) => (offset === 0 ? match : " "));
  result = result.replace(/\bCo\s*\.\s*,\s*Ltd\s*\.\s*\./g, "Co., Ltd.");
  result = result.replace(/\bCo\s*\.\s*,\s*Ltd\s*\./g, "Co., Ltd.");
  result = result.replace(/\bEHB\s+T-75\b/g, "EHBT-75");
  result = result.replace(/\bA\s+4\b/g, "A4");
  result = result.replace(/\bA\s+1\b/g, "A1");
  result = result.replace(/\bAMD\s+1\b/g, "AMD1");
  result = result.replace(/\bIEEE\s+802\.\s+11\s*/g, "IEEE 802.11");
  result = result.replace(/\[\s*\.\s*\.\s*\.\s*\]/g, "[...]");
  result = result.replace(/\bozellemed\.\s+com\b/g, "ozellemed.com");
  return result;
};

export const fixSpacingArtifacts = (text: string) => {
  if (!text || !LATIN_CHAR_REGEX.test(text)) return text;
  const segments = text.split(NEWLINE_CAPTURE);
  return segments
    .map((segment) => {
      if (!segment || NEWLINE_CAPTURE.test(segment)) {
        return segment;
      }
      return fixSegmentSpacing(segment);
    })
    .join("");
};

const adjustLongFormStatus = (text: string) => {
  if (!text) return text;
  const isLongForm = text.length > LONG_FORM_THRESHOLD || /[.;:!?]/.test(text);
  if (!isLongForm) return text;
  let output = text;

  output = output.replace(/\bElevated fever\b/gi, "high fever");
  output = output.replace(/\bAn Elevated\b/gi, "An increase");
  output = output.replace(/\bA Decreased\b/gi, "A decrease");
  output = output.replace(/\bAn Decreased\b/gi, "A decrease");
  output = output.replace(/\b(slight|mild)\s+Elevated\b/gi, (_match, level) => {
    return `${level} increase`;
  });
  output = output.replace(/\b(slight|mild)\s+Decreased\b/gi, (_match, level) => {
    return `${level} decrease`;
  });

  output = output.replace(/\bElevated in\b/gi, (match) => {
    return match[0] === "E" ? "Increase in" : "increase in";
  });
  output = output.replace(/\bDecreased in\b/gi, (match) => {
    return match[0] === "D" ? "Decrease in" : "decrease in";
  });

  output = output.replace(
    /\bElevated total (spherocytes|ghost cells|reticulocytes)\s+is\b/gi,
    (_match, group) => `Elevated total ${group} are`
  );

  output = output.replace(/\bElevated in the number of\b/gi, (match) => {
    return match[0] === "E" ? "Increase in the number of" : "increase in the number of";
  });
  output = output.replace(/\bDecreased in the number of\b/gi, (match) => {
    return match[0] === "D" ? "Decrease in the number of" : "decrease in the number of";
  });

  return output;
};

const preserveUiMarkerSymbols = (original: string, translated: string) => {
  if (!original || !translated) return translated;
  const markers = Array.from(original.matchAll(UI_MARKER_REGEX)).map((match) => ({
    full: `${match[1]}${match[2]}${match[3]}`,
    label: match[2].trim()
  }));
  if (!markers.length) return translated;
  let output = translated;
  markers.forEach(({ full, label }) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const anyWrapped = new RegExp(
      `[『「“"'《【\\[«]\\s*${escaped}\\s*[』」”"'》】\\]»]`,
      "gi"
    );
    output = output.replace(anyWrapped, full);
  });
  return output;
};

const fixEnglishGlueArtifacts = (
  original: string,
  translated: string,
  targetLang?: TargetLanguage
) => {
  if (!translated) return translated;
  if (!String(targetLang || "").toLowerCase().includes("english")) return translated;
  let output = translated;

  output = output.replace(/\b([A-Z]{2,}\d*(?:\/[A-Z]+)?)([A-Z][a-z]{2,})\b/g, "$1 $2");
  output = output.replace(/\b([A-Z]{2,}\d*)([a-z]{2,})\b/g, "$1 $2");
  output = output.replace(EN_WORD_GLUE_REGEX, (_match, left, right) => {
    return `${left} ${right}`;
  });
  EN_EXACT_TOKEN_FIXES.forEach(([pattern, replacement]) => {
    output = output.replace(pattern, replacement);
  });
  for (let i = 0; i < 3; i += 1) {
    const next = output
      .replace(ANALYZER_PREFIX_REGEX, (_match, left, right) => `${left} ${lowerFirst(right)}`)
      .replace(ANALYZER_SUFFIX_REGEX, (_match, left, right) => `${left} ${lowerFirst(right)}`);
    if (next === output) break;
    output = next;
  }
  output = output.replace(ANALYZER_LOWERCASE_LEFT_REGEX, (_match, left) => {
    return `${left} analyzer`;
  });
  output = output.replace(
    /\b(analyzer)(the|specified|itself|safety|interface|range|operation|maintenance|manual|procedures?)\b/gi,
    (_match, left, right) => `${left} ${right}`
  );
  output = output.replace(/\b(interface)(prepare)\b/gi, "$1 $2");
  output = output.replace(/\b(collection)(and)\b/gi, "$1 $2");
  output = output.replace(/\b(consumables),(?=[A-Za-z])/g, "consumables, ");
  output = output.replace(/\b(complete)(sample)\b/gi, "$1 $2");
  output = output.replace(/\b(Hunan)\s+(Yi\s*Hong)(?=\s+Health\s+Technology)/gi, "$1 Ehome");
  output = output.replace(
    /\bHunan\s+E[a-z]{2,10}\s+Health\s+Technology\s+Co\.?\s*,?\s*Ltd\.?\b/gi,
    "Hunan Ehome Health Technology Co., Ltd."
  );
  output = output.replace(
    /\bHunan\s+Yi\s*Hong\s+Health\s+Technology\s+Co\.?\s*,?\s*Ltd\.?\b/gi,
    "Hunan Ehome Health Technology Co., Ltd."
  );
  output = output.replace(
    /\bE[a-z]{2,10}\s+Health\s+Technology\s+Co\.?\s*,?\s*Ltd\.?\b/gi,
    "Ehome Health Technology Co., Ltd."
  );
  output = preserveUiMarkerSymbols(original, output);
  return output;
};

const fixRussianEnglishResidue = (translated: string, targetLang?: TargetLanguage) => {
  if (!translated || !String(targetLang || "").toLowerCase().includes("russian")) return translated;
  if (!/[\u0400-\u04FF]/.test(translated) || !/[A-Za-z]/.test(translated)) return translated;
  let output = translated;
  RUSSIAN_MODEL_ARTIFACT_FIXES.forEach(([pattern, replacement]) => {
    output = output.replace(pattern, replacement);
  });
  RUSSIAN_RESIDUE_FIXES.forEach(([pattern, replacement]) => {
    output = output.replace(pattern, replacement);
  });
  output = output.replace(/Запись запись/g, "Запись").replace(/запись запись/g, "запись");
  return output;
};

const fixBracketArtifacts = (text: string) => {
  if (!text) return text;
  let output = text;
  // Some model outputs duplicate closing brackets around model codes.
  output = output.replace(/\)\)+/g, ")");
  output = output.replace(/\]\]+/g, "]");
  output = output.replace(/\}\}+/g, "}");
  output = output.replace(/\)\.\)/g, ").");
  return output;
};

export const polishTranslation = (
  original: string,
  translated: string,
  targetLang?: TargetLanguage
) => {
  if (typeof translated !== "string") return translated;
  let refined = fixSpacingArtifacts(translated);
  refined = fixBracketArtifacts(refined);
  refined = fixEnglishGlueArtifacts(original || "", refined, targetLang);
  refined = fixRussianEnglishResidue(refined, targetLang);
  refined = enforceGlossary(original || "", refined, targetLang);
  refined = enforceSeedTerminology(original || "", refined, targetLang);
  refined = adjustLongFormStatus(refined);
  return refined;
};
