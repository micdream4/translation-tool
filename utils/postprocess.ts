import { enforceGlossary } from "./glossary";
import { collectTargetDiacriticRisks } from "./languageProfiles";
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
  [/\bSickle cell disease\b/gi, "серповидноклеточная болезнь"],
  [/\bPlasmodium infection\b/gi, "инфекция Plasmodium"],
  [/\bСрок\s+service\s+службы\b/gi, "Срок службы"]
];
const RUSSIAN_CHINESE_RESIDUE_FIXES: Array<[RegExp, string]> = [
  [/без\s*明显(?:ных?)?\s+отклонений/gi, "без явных отклонений"],
  [/без\s*明显(?:ных?)?\s+признаков/gi, "без явных признаков"],
  [/без\s*明显ной\s+аллергии/gi, "без явной аллергии"],
  [/нехарактерно для\s*单纯ной/gi, "нехарактерно для изолированной"],
  [/нехарактерно для\s*單純ной/gi, "нехарактерно для изолированной"],
  [/не поддерживают\s*单纯ную/gi, "не поддерживают изолированную"],
  [/не поддерживают\s*單純ную/gi, "не поддерживают изолированную"],
  [/не\s*單純\s+бактериальной/gi, "не изолированной бактериальной"],
  [/а не\s*单纯\s+нейтрофильной/gi, "а не изолированной нейтрофильной"],
  [/а не\s*單純\s+нейтрофильной/gi, "а не изолированной нейтрофильной"],
  [/способности иммунной системы\s*清除\s+патогены/gi, "способности иммунной системы элиминировать патогены"],
  [/не\s+наблюдаетсяявно的\s+цитологических признаков/gi, "не наблюдается явных цитологических признаков"],
  [/может\s*叠加\s+с/gi, "может сочетаться с"],
  [/требуется\s*结合\s+с\s+мазком крови и клинической ситуацией/gi, "требуется оценка с учетом мазка крови и клинической ситуации"],
  [/требуется\s*结合\s+с\s+мазком крови или дополнительными исследованиями/gi, "требуется сопоставить с мазком крови или дополнительными исследованиями"],
  [/требуется\s*结合\s+с\s+инфекцией\/воспалением или гематологическими нарушениями/gi, "требуется оценка с учетом инфекции/воспаления или гематологических нарушений"],
  [/同时伴有\s+увеличение/gi, "одновременно сопровождается увеличением"],
  [/请结合/gi, "следует учитывать"],
  [/明显ное\s+повышение/gi, "выраженное повышение"],
  [/明显ную\s+активацию/gi, "выраженную активацию"],
  [/明显\s+активация/gi, "выраженная активация"],
  [/明显\s+бактериальную/gi, "явную бактериальную"],
  [/без\s*明显/gi, "без явных"],
  [/明显ных/gi, "явных"],
  [/明显ной/gi, "явной"],
  [/明显ную/gi, "выраженную"],
  [/明显ное/gi, "выраженное"],
  [/明显/gi, "явно"],
  [/явно的/gi, "явных"],
  [/单纯ной/gi, "изолированной"],
  [/单纯ную/gi, "изолированную"],
  [/单纯/gi, "изолированной"],
  [/單純ной/gi, "изолированной"],
  [/單純ную/gi, "изолированную"],
  [/單純/gi, "изолированной"],
  [/清除/gi, "элиминировать"],
  [/结合/gi, "с учетом"],
  [/叠加/gi, "сочетание"],
  [/同时伴有/gi, "одновременно сопровождается"]
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
const FRENCH_CHINESE_RESIDUE_FIXES: Array<[RegExp, string]> = [
  [/([A-Za-zÀ-ÖØ-öø-ÿœŒ])复合/g, "$1 complexe"],
  [/复合([A-Za-zÀ-ÖØ-öø-ÿœŒ])/g, "complexe $1"],
  [/复合/g, "complexe"]
];
const FRENCH_GRAMMAR_ARTIFACT_FIXES: Array<[RegExp, string]> = [
  [/\binfection a (cytomégalovirus|toxoplasme)\b/gi, "infection à $1"],
  [/\binfection a EB virus\b/gi, "infection par le virus EB"],
  [/\bréaction a une infection\b/gi, "réaction à une infection"],
  [/\bdue a une infection\b/gi, "due à une infection"],
  [/\bdue a (un|une|des?|l')\b/gi, "due à $1"],
  [/\bdû a (un|une|des?|l')\b/gi, "dû à $1"],
  [/\bdues a (un|une|des?|l')\b/gi, "dues à $1"],
  [/\bcommencé a accélérer\b/gi, "commencé à accélérer"],
  [/\bréaction compensatoire a l'anémie\b/gi, "réaction compensatoire à l'anémie"],
  [/\baider a déterminer\b/gi, "aider à déterminer"],
  [/\bl'organisme a combattre\b/gi, "l'organisme à combattre"],
  [/\bneutrophiles a noyau\b/gi, "neutrophiles à noyau"],
  [/\ba noyau en batonnet\b/gi, "à noyau en bâtonnet"],
  [/\bà noyau en batonnet\b/gi, "à noyau en bâtonnet"]
];
const MEDICAL_CODE_REGEX =
  /(?<![A-Za-z0-9])(?:WBC|RBC|HGB|HCT|MCV|MCHC?|RDW|PLT|NEU|NST|NSG|NSH|LYM|MONO|MON|EOS|BASO|BAS|ALY|LIC|RET|NRBC|AWBC|SRBC)(?:[#%])?(?![A-Za-z0-9])/g;
const MEDICAL_CODE_PLACEHOLDER_ARTIFACT_REGEX =
  /\b(?:WBC|RBC|HGB|HCT|MCV|MCHC?|RDW|PLT|NEU|NST|NSG|NSH|LYM|MONO|MON|EOS|BASO|BAS|ALY|LIC|RET|NRBC|AWBC|SRBC)\s+\d+_+\b/g;
const BROKEN_HASH_CODE_REGEX =
  /\b(WBC|RBC|HGB|HCT|MCV|MCHC?|RDW|PLT|NEU|NST|NSG|NSH|LYM|MONO|MON|EOS|BASO|BAS|ALY|LIC|RET|NRBC|AWBC|SRBC)_+\b/g;
const VITAMIN_B12_REGEX = /\bB\s+12\b/g;
const EXACT_SHORT_SOURCE_TRANSLATIONS: Record<string, Record<string, string>> = {
  french: {
    名称: "Nom",
    几率: "Probabilité",
    分析: "Analyse",
    序号: "N°",
    解读: "Interprétation",
    总结1: "Résumé 1",
    总结2: "Résumé 2",
    总结3: "Résumé 3",
    可能疾病1: "Maladie possible 1",
    可能疾病2: "Maladie possible 2",
    可能疾病3: "Maladie possible 3"
  },
  russian: {
    名称: "Название",
    几率: "Вероятность",
    分析: "Анализ",
    序号: "№",
    解读: "Интерпретация",
    总结1: "Резюме 1",
    总结2: "Резюме 2",
    总结3: "Резюме 3",
    可能疾病1: "Возможное заболевание 1",
    可能疾病2: "Возможное заболевание 2",
    可能疾病3: "Возможное заболевание 3",
    提示骨髓造血功能可能减低: "Указывает на возможное снижение кроветворной функции костного мозга"
  },
  portuguese: {
    名称: "Nome",
    几率: "Probabilidade",
    分析: "Análise",
    序号: "N.º",
    解读: "Interpretação",
    总结1: "Resumo 1",
    总结2: "Resumo 2",
    总结3: "Resumo 3",
    可能疾病1: "Doença possível 1",
    可能疾病2: "Doença possível 2",
    可能疾病3: "Doença possível 3"
  },
  italian: {
    名称: "Nome",
    几率: "Probabilità",
    分析: "Analisi",
    序号: "N.",
    解读: "Interpretazione",
    总结1: "Sintesi 1",
    总结2: "Sintesi 2",
    总结3: "Sintesi 3",
    可能疾病1: "Possibile malattia 1",
    可能疾病2: "Possibile malattia 2",
    可能疾病3: "Possibile malattia 3"
  }
};
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
  result = result.replace(/\bCo\s*\.\s*,\s*Ltd\b(?:\s*\.)+/g, "Co., Ltd.");
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
  result = result.replace(/([,.;!?])(?=[^\s"')\]\}\d])/g, "$1 ");
  result = result.replace(/:(?!\/\/)(?=[^\s"')\]\}])/g, ": ");
  result = result.replace(/([.!?])([A-Z])/g, "$1 $2");
  result = result.replace(/([a-z])([A-Z][a-z])/g, "$1 $2");
  result = result.replace(/([0-9])([A-Za-z])/g, "$1 $2");
  result = result.replace(/([A-Za-z])([0-9])/g, "$1 $2");
  result = result.replace(/ {2,}/g, (match, offset) => (offset === 0 ? match : " "));
  result = result.replace(/\bCo\s*\.\s*,\s*Ltd\b(?:\s*\.)+/g, "Co., Ltd.");
  result = result.replace(/\bEHB\s+T-75\b/g, "EHBT-75");
  result = result.replace(/\bA\s+4\b/g, "A4");
  result = result.replace(/\bA\s+1\b/g, "A1");
  result = result.replace(/\bAMD\s+1\b/g, "AMD1");
  result = result.replace(/\bIEEE\s+802\.\s+11\s*/g, "IEEE 802.11");
  result = result.replace(/\[\s*\.\s*\.\s*\.\s*\]/g, "[...]");
  result = result.replace(/\bozellemed\.\s+com\b/g, "ozellemed.com");
  result = result.replace(/\b([eE])\s*\.\s*g\s*\.\s*,/g, "$1.g.,");
  result = result.replace(/\b([eE])\s*\.\s*g\s*\./g, "$1.g.");
  result = result.replace(/\b([iI])\s*\.\s*e\s*\.\s*,/g, "$1.e.,");
  result = result.replace(/\b([iI])\s*\.\s*e\s*\./g, "$1.e.");
  result = result.replace(/\b(etc|vs|fig|no)\.\s+([,;:])/gi, "$1.$2");
  result = result.replace(/\bCo\s*\.\s*,\s*Ltd\b(?:\s*\.)+/g, "Co., Ltd.");
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
    /\bHunan\s+E[a-z]{2,10}\s+Health\s+Technology\s+Co\.?\s*,?\s*Ltd\b(?:\s*\.)*/gi,
    "Hunan Ehome Health Technology Co., Ltd."
  );
  output = output.replace(
    /\bHunan\s+Yi\s*Hong\s+Health\s+Technology\s+Co\.?\s*,?\s*Ltd\b(?:\s*\.)*/gi,
    "Hunan Ehome Health Technology Co., Ltd."
  );
  output = output.replace(
    /\bE[a-z]{2,10}\s+Health\s+Technology\s+Co\.?\s*,?\s*Ltd\b(?:\s*\.)*/gi,
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

const fixRussianChineseResidue = (translated: string, targetLang?: TargetLanguage) => {
  if (!translated || !String(targetLang || "").toLowerCase().includes("russian")) return translated;
  if (!/[\u4e00-\u9fff]/.test(translated)) return translated;
  let output = translated;
  RUSSIAN_CHINESE_RESIDUE_FIXES.forEach(([pattern, replacement]) => {
    output = output.replace(pattern, replacement);
  });
  return output;
};

const normalizeTargetKey = (targetLang?: TargetLanguage) => {
  const normalized = String(targetLang || "").toLowerCase();
  if (normalized.includes("french")) return "french";
  if (normalized.includes("russian")) return "russian";
  if (normalized.includes("portuguese")) return "portuguese";
  if (normalized.includes("italian")) return "italian";
  return "";
};

const getExactShortSourceTranslation = (original: string, targetLang?: TargetLanguage) => {
  const targetKey = normalizeTargetKey(targetLang);
  if (!targetKey) return "";
  const source = String(original || "").trim();
  return EXACT_SHORT_SOURCE_TRANSLATIONS[targetKey]?.[source] || "";
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const matchTokenCase = (token: string, preferred: string) => {
  if (!token) return preferred;
  if (token === token.toUpperCase()) return preferred.toUpperCase();
  if (token[0] === token[0].toUpperCase()) {
    return `${preferred[0]?.toUpperCase() || ""}${preferred.slice(1)}`;
  }
  return preferred;
};

const fixTargetDiacritics = (translated: string, targetLang?: TargetLanguage) => {
  if (!translated) return translated;
  let output = translated;
  collectTargetDiacriticRisks(output, targetLang).forEach(({ token, preferred }) => {
    if (!token || !preferred) return;
    output = output.replace(
      new RegExp(`\\b${escapeRegExp(token)}\\b`, "g"),
      (match) => matchTokenCase(match, preferred)
    );
  });
  return output;
};

const fixFrenchChineseResidue = (translated: string, targetLang?: TargetLanguage) => {
  if (!translated || !String(targetLang || "").toLowerCase().includes("french")) return translated;
  let output = translated;
  FRENCH_CHINESE_RESIDUE_FIXES.forEach(([pattern, replacement]) => {
    output = output.replace(pattern, replacement);
  });
  return output;
};

const fixFrenchGrammarArtifacts = (translated: string, targetLang?: TargetLanguage) => {
  if (!translated || !String(targetLang || "").toLowerCase().includes("french")) return translated;
  let output = translated;
  FRENCH_GRAMMAR_ARTIFACT_FIXES.forEach(([pattern, replacement]) => {
    output = output.replace(pattern, replacement);
  });
  return output;
};

const PORTUGUESE_BR_LOCALE_FIXES: Array<[RegExp, string]> = [
  [/\binfeção\b/gi, "infecção"],
  [/\binfeções\b/gi, "infecções"],
  [/\binfeciosa\b/gi, "infecciosa"],
  [/\binfeciosas\b/gi, "infecciosas"],
  [/\binfecioso\b/gi, "infeccioso"],
  [/\binfeciosos\b/gi, "infecciosos"],
  [/\bsistémica\b/gi, "sistêmica"],
  [/\bsistémicas\b/gi, "sistêmicas"],
  [/\bsistémico\b/gi, "sistêmico"],
  [/\bsistémicos\b/gi, "sistêmicos"],
  [/\bdetetada\b/gi, "detectada"],
  [/\bdetetado\b/gi, "detectado"],
  [/\bparotidite\s+epid[ée]mica\b/gi, "caxumba"]
];

const fixPortugueseBrazilianLocaleArtifacts = (
  translated: string,
  targetLang?: TargetLanguage
) => {
  if (!translated || !String(targetLang || "").toLowerCase().includes("portuguese")) return translated;
  let output = translated;
  output = output.replace(/\bDetetou-se\b/g, "Detectou-se").replace(/\bdetetou-se\b/g, "detectou-se");
  PORTUGUESE_BR_LOCALE_FIXES.forEach(([pattern, replacement]) => {
    output = output.replace(pattern, replacement);
  });
  return output;
};

const fixPortugueseGrammarArtifacts = (translated: string, targetLang?: TargetLanguage) => {
  if (!translated || !String(targetLang || "").toLowerCase().includes("portuguese")) return translated;
  let output = translated;
  output = output.replace(/\bPor favor,?\s+análise\b/gi, "Por favor, analise");
  output = output.replace(/\bpor favor,?\s+análise\b/g, "por favor analise");
  output = output.replace(/(^|[.!?]\s+)Análise(?=\s+em conjunto\b)/g, "$1Analise");
  output = output.replace(/(^|[.!?]\s+)análise(?=\s+em conjunto\b)/g, "$1analise");
  output = output.replace(/\bpós[-\s]+operatório\b/gi, "pós-operatório");
  output = output.replace(/\ba esquerda\b/gi, "à esquerda");
  output = output.replace(/\ba direita\b/gi, "à direita");
  output = output.replace(/\bdesvio nuclear para à direita\b/gi, "desvio nuclear à direita");
  output = output.replace(/\bdesvio para à direita\b/gi, "desvio à direita");
  output = output.replace(/\bpara à direita\b/gi, "para a direita");
  output = output.replace(/\bp[oó]s[-\s]+infecção\b/gi, "pós-infecção");
  output = output.replace(/\bpos[-\s]+infec[cç][aã]o\b/gi, "pós-infecção");
  output = output.replace(/\bpos[-\s]+trauma\b/gi, "pós-trauma");
  output = output.replace(/\bma\s+absorção\b/gi, "má absorção");
  output = output.replace(/\b(o número de eritrócitos\s*\(RBC\))\s+é\s+(a hemoglobina\s*\(HGB\)\s+est[ãa]o)\b/gi, "$1 e $2");
  output = output.replace(
    /\besta\s+(atualmente|respondendo|reagindo|fazendo|aumentando|diminu[ií]d[oa]s?|elevad[oa]s?|comprometid[oa]s?|associad[oa]s?|relacionad[oa]s?|presente|ausente|normal|em\b|frequentemente|aumentad[oa]s?|ativad[oa]s?|reduzid[oa]s?|suprimid[oa]s?|compat[íi]vel|envolvid[oa]s?)/gi,
    "está $1"
  );
  output = output.replace(
    /\bestao\s+(atualmente|respondendo|reagindo|fazendo|aumentando|diminu[ií]d[oa]s?|elevad[oa]s?|comprometid[oa]s?|associad[oa]s?|relacionad[oa]s?|presentes|ausentes|normais|em\b|frequentemente|aumentad[oa]s?|ativad[oa]s?|reduzid[oa]s?|suprimid[oa]s?|compat[íi]veis|envolvid[oa]s?)/gi,
    "estão $1"
  );
  output = output.replace(
    /\b(levando|leva|levou)\s+a\s+Anemia\b/g,
    "$1 à anemia"
  );
  output = output.replace(
    /\b(levando|leva|levou)\s+a\s+(diminuição|redução|alteração|reação|infecção|inflamação|anemia)\b/gi,
    "$1 à $2"
  );
  output = output.replace(
    /\b(devido|associad[oa]s?|relacionad[oa]s?|secundári[oa]s?|resposta)\s+a\s+(infecção|inflamação|reação|alteração|condição|situação|diminuição|redução|anemia)\b/gi,
    "$1 à $2"
  );
  output = output.replace(/\bem resposta a\s+(infecção|inflamação|reação)\b/gi, "em resposta à $1");
  output = output.replace(/\b(AWBC|WBC|RBC|HGB|NEU|LYM|MON|EOS|BAS|ALY|NST#?|NSG#?|NSH#?|RET#?|RET%|PLT)([^.;,\n]{0,80}?)\s+e\s+(uma?|a|o|comum|observad[oa]s?|predominante|impulsionad[oa]s?|consistente|compat[íi]vel|caracter[íi]stic[oa]s?|a\s+manifestação|uma\s+manifestação)\b/g, "$1$2 é $3");
  output = output.replace(/\b((?:O|A|Os|As)\s+[^.;,\n]{1,100}?)\s+e\s+(comum|observad[oa]s?|predominante|impulsionad[oa]s?|consistente|compat[íi]vel|caracter[íi]stic[oa]s?|a\s+manifestação|uma\s+manifestação)\b/gi, "$1 é $2");
  output = output.replace(/\b(elevação|diminuição|infecção|inflamação|reação|anemia|neutropenia|leucopenia|basofilia|eosinofilia|linfocitose|monocitose|distúrbio)([^.;,\n]{0,80}?)\s+e\s+(comum|observad[oa]s?|predominante|impulsionad[oa]s?|consistente|compat[íi]vel|caracter[íi]stic[oa]s?|a\s+manifestação|uma\s+manifestação)\b/gi, "$1$2 é $3");
  output = output.replace(/\bo que\s+e\s+/gi, "o que é ");
  output = output.replace(/\bque\s+e\s+(?:do tipo|uma?|o|a)\b/gi, (match) =>
    match.replace(/\be\b/i, "é")
  );
  output = output.replace(
    /\b(tipo de anemia|estado anêmico|padrão anêmico|sistema hematopoético[^.;,\n]{0,60}|indicadores? eritrocitários[^.;,\n]{0,60}|neutrofilia|anemia|esse tipo de anemia|essa combinação|este conjunto)\s+e\s+(mais\s+comum|consistente|compat[íi]vel|macroc[íi]tic[ao]s?|microc[íi]tic[ao]s?|hipocr[oô]mic[ao]s?|regenerativ[ao]s?|uma\s+resposta|um\s+processo|distúrbio)\b/gi,
    "$1 é $2"
  );
  output = output.replace(
    /\be\s+(altamente|mais\s+prov[áa]vel|mais\s+comum|cr[oô]nic[ao]s?|agud[ao]s?|insuficiente|do\s+tipo|uma?\s+manifestação|uma\s+resposta|um\s+processo|distúrbio|devid[ao]s?|necessári[oa]s?|normal|comum|visto|vista|observ[áa]vel|observad[oa]s?|compat[íi]vel|predominante|macroc[íi]tic[ao]s?|microc[íi]tic[ao]s?|hipocr[oô]mic[ao]s?|regenerativ[ao]s?|t[íi]pic[oa]s?)\b/gi,
    "é $1"
  );
  output = output.replace(/\b(alterações|indicadores|parâmetros|resultados)([^.;,\n]{0,80}?)\s+tem\s+(correlação|relação|significado|origem)\b/gi, "$1$2 têm $3");
  return output;
};

const fixItalianMedicalCodeOmissions = (
  original: string,
  translated: string,
  targetLang?: TargetLanguage
) => {
  if (!translated || !String(targetLang || "").toLowerCase().includes("italian")) return translated;
  if (!/\bNEU\b/.test(original) || !/(^|[^A-Za-z0-9])NSH#(?![A-Za-z0-9])/.test(original) || /\bNEU\b/.test(translated)) {
    return translated;
  }
  return translated.replace(
    /\b(L['’]aumento\s+dei\s+)neutrofili\s+polisegmentati\s*\(NSH#\)/i,
    "$1neutrofili (NEU) e dei neutrofili polisegmentati (NSH#)"
  );
};

const restoreFrenchNumericMonth = (
  original: string,
  translated: string,
  targetLang?: TargetLanguage
) => {
  if (!original || !translated || !String(targetLang || "").toLowerCase().includes("french")) return translated;
  if (!/[＞>]\s*1\s*个月|1\s*个月/.test(original)) return translated;
  return translated.replace(/\bplus d['’]un mois\b/gi, "plus de 1 mois");
};

const restoreMedicalCodePlaceholderArtifacts = (original: string, translated: string) => {
  if (
    !translated ||
    (!MEDICAL_CODE_PLACEHOLDER_ARTIFACT_REGEX.test(translated) && !BROKEN_HASH_CODE_REGEX.test(translated))
  ) {
    MEDICAL_CODE_PLACEHOLDER_ARTIFACT_REGEX.lastIndex = 0;
    BROKEN_HASH_CODE_REGEX.lastIndex = 0;
    return translated;
  }
  MEDICAL_CODE_PLACEHOLDER_ARTIFACT_REGEX.lastIndex = 0;
  BROKEN_HASH_CODE_REGEX.lastIndex = 0;
  const normalizeCode = (value: string) => value.replace(/[#%]+$/g, "");
  const sourceCodesAll = Array.from(String(original || "").matchAll(MEDICAL_CODE_REGEX), (match) => match[0]);
  const preferredSourceCodeByBase = new Map<string, string>();
  sourceCodesAll.forEach((code) => {
    const base = normalizeCode(code);
    if (!preferredSourceCodeByBase.has(base) || /[#%]$/.test(code)) {
      preferredSourceCodeByBase.set(base, code);
    }
  });
  let output = translated.replace(BROKEN_HASH_CODE_REGEX, (match, code) => {
    return preferredSourceCodeByBase.get(code) || match.replace(/_+$/g, "#");
  });
  const targetWithoutArtifacts = output
    .replace(MEDICAL_CODE_PLACEHOLDER_ARTIFACT_REGEX, " ")
    .replace(BROKEN_HASH_CODE_REGEX, " ");
  const targetCodes = new Set(
    Array.from(targetWithoutArtifacts.matchAll(MEDICAL_CODE_REGEX), (match) => normalizeCode(match[0]))
  );
  const sourceCodes = sourceCodesAll.filter((code) => !targetCodes.has(normalizeCode(code)));
  if (!sourceCodes.length) return output;
  let cursor = 0;
  return output.replace(MEDICAL_CODE_PLACEHOLDER_ARTIFACT_REGEX, () => sourceCodes[cursor++] || sourceCodes[sourceCodes.length - 1]);
};

const restoreMedicalCodeSuffixes = (original: string, translated: string) => {
  if (!original || !translated) return translated;
  const preferredSourceCodeByBase = new Map<string, string>();
  const sourceSuffixCountByBase = new Map<string, number>();
  const sourceSuffixFormsByBase = new Map<string, Set<string>>();
  Array.from(String(original || "").matchAll(MEDICAL_CODE_REGEX), (match) => match[0]).forEach((code) => {
    if (!/[#%]$/.test(code)) return;
    const base = code.replace(/[#%]+$/g, "");
    sourceSuffixCountByBase.set(base, (sourceSuffixCountByBase.get(base) || 0) + 1);
    if (!sourceSuffixFormsByBase.has(base)) sourceSuffixFormsByBase.set(base, new Set());
    sourceSuffixFormsByBase.get(base)?.add(code);
    if (!preferredSourceCodeByBase.has(base)) preferredSourceCodeByBase.set(base, code);
  });
  if (!preferredSourceCodeByBase.size) return translated;
  let output = translated;
  preferredSourceCodeByBase.forEach((preferred, base) => {
    const targetSuffixPattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(base)}[#%](?![A-Za-z0-9])`, "g");
    const sourceSuffixForms = sourceSuffixFormsByBase.get(base) || new Set<string>();
    if (sourceSuffixForms.size === 1) {
      output = output.replace(targetSuffixPattern, preferred);
    }
    const sourceSuffixCount = sourceSuffixCountByBase.get(base) || 0;
    const targetSuffixCount = Array.from(output.matchAll(targetSuffixPattern)).length;

    if (targetSuffixCount < sourceSuffixCount) {
      let missing = sourceSuffixCount - targetSuffixCount;
      const barePattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(base)}(?![#%A-Za-z0-9])`, "g");
      output = output.replace(barePattern, (match) => {
        if (missing <= 0) return match;
        missing -= 1;
        return preferred;
      });
    }

    if (targetSuffixCount > sourceSuffixCount) {
      let seen = 0;
      output = output.replace(targetSuffixPattern, (match) => {
        seen += 1;
        return seen > sourceSuffixCount ? base : match;
      });
    }
  });
  return output;
};

const restoreSourceUnitNotation = (original: string, translated: string) => {
  if (!original || !translated) return translated;
  let output = translated;
  const source = String(original);
  if (source.includes("g/L")) {
    output = output.replace(/(\d+(?:[.,]\d+)?\s*)г\s*\/\s*л/gi, "$1g/L");
  }
  if (source.includes("fL")) {
    output = output.replace(/(\d+(?:[.,]\d+)?\s*)фл/gi, "$1fL");
  }
  if (source.includes("pg")) {
    output = output.replace(/(\d+(?:[.,]\d+)?\s*)пг/gi, "$1pg");
  }
  if (source.includes("mmol/L")) {
    output = output.replace(/(\d+(?:[.,]\d+)?\s*)ммоль\s*\/\s*л/gi, "$1mmol/L");
  }
  if (source.includes("10^9/L")) {
    output = output.replace(/(\d+(?:[.,]\d+)?\s*)10\^9\s*\/\s*л/gi, "$110^9/L");
  }
  if (source.includes("10^12/L")) {
    output = output.replace(/(\d+(?:[.,]\d+)?\s*)10\^12\s*\/\s*л/gi, "$110^12/L");
  }
  return output;
};

const restoreSourceMedicalCodeMentions = (original: string, translated: string) => {
  if (!original || !translated) return translated;
  let output = translated;
  const source = String(original);
  if (source.includes("RET%")) {
    output = output.replace(/процент[а]?\s+RET#/gi, "RET%");
  }
  if (source.includes("LYM")) {
    output = output.replace(/повышение лимфоцитов и незрелых гранулоцитов/gi, "повышение LYM и незрелых гранулоцитов");
  }
  if (source.includes("NEU")) {
    output = output.replace(
      /Повышение нейтрофилов с гиперсегментацией ядра \(NSH#\)/g,
      "Повышение нейтрофилов (NEU) с гиперсегментацией ядра (NSH#)"
    );
  }
  if (source.includes("HPLC")) {
    output = output.replace(/ВЭЖХ/g, "HPLC");
  }
  return output;
};

const fixProtectedMedicalTokenSpacing = (translated: string) =>
  String(translated || "")
    .replace(VITAMIN_B12_REGEX, "B12")
    .replace(/\bTh\s+([12])(?=\b|[-\s]?типа\b)/g, "Th$1")
    .replace(/\bB\s+6\b/g, "B6")
    .replace(/\bB12\/\s+ou\b/gi, "B12 ou")
    .replace(/\bB12\/\s+или/gi, "B12 или")
    .replace(/B12\s*\/\s*\//g, "B12/")
    .replace(/витамина\s+RBC\s+0_+\b/gi, "витамина B12")
    .replace(/витамин\s+RBC\s+0_+\b/gi, "витамин B12")
    .replace(/\bvitamine\s+RBC\s+0_+\b/gi, "vitamine B12")
    .replace(/\bvitamina\s+RBC\s+0_+\b/gi, "vitamina B12");

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
  const exactShortTranslation = getExactShortSourceTranslation(original || "", targetLang);
  if (exactShortTranslation) return exactShortTranslation;
  let refined = fixSpacingArtifacts(translated);
  refined = fixBracketArtifacts(refined);
  refined = fixEnglishGlueArtifacts(original || "", refined, targetLang);
  refined = fixRussianEnglishResidue(refined, targetLang);
  refined = fixRussianChineseResidue(refined, targetLang);
  refined = restoreMedicalCodePlaceholderArtifacts(original || "", refined);
  refined = restoreMedicalCodeSuffixes(original || "", refined);
  refined = restoreSourceUnitNotation(original || "", refined);
  refined = restoreSourceMedicalCodeMentions(original || "", refined);
  refined = fixProtectedMedicalTokenSpacing(refined);
  refined = enforceGlossary(original || "", refined, targetLang);
  refined = enforceSeedTerminology(original || "", refined, targetLang);
  refined = adjustLongFormStatus(refined);
  refined = restoreFrenchNumericMonth(original || "", refined, targetLang);
  refined = fixTargetDiacritics(refined, targetLang);
  refined = fixFrenchChineseResidue(refined, targetLang);
  refined = fixFrenchGrammarArtifacts(refined, targetLang);
  refined = fixPortugueseBrazilianLocaleArtifacts(refined, targetLang);
  refined = fixPortugueseGrammarArtifacts(refined, targetLang);
  refined = fixItalianMedicalCodeOmissions(original || "", refined, targetLang);
  return refined;
};
