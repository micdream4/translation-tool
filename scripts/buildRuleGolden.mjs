// Generates the seed rule golden set (fixtures/rule-golden.jsonl) from category templates.
// Each case states what the quality check SHOULD say, independent of any particular document:
//   expect: "pass"   -> no finding is acceptable
//   expect: "flag"   -> at least one finding of `expectTypes` is required
//   expect: "either" -> ambiguous by policy; tracked but not scored
// Re-run after editing templates: npm run rule:golden:build
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outPath = path.join(repoRoot, "fixtures/rule-golden.jsonl");

const LANGS = {
  English: { code: "en", manufacturer: "Manufacturer", address: "Address", ecRep: "EU representative", power: "Press the power button to start the analyzer.", wbc: "WBC count is elevated." },
  Chinese: { code: "zh", manufacturer: "制造商", address: "地址", ecRep: "欧盟代表", power: "按下电源键启动分析仪。", wbc: "WBC 计数升高。" },
  "Traditional Chinese (Taiwan)": { code: "zh-TW", manufacturer: "製造商", address: "地址", ecRep: "歐盟代表", power: "按下電源鍵啟動分析儀。", wbc: "WBC 計數升高。" },
  Spanish: { code: "es", manufacturer: "Fabricante", address: "Dirección", ecRep: "Representante en la UE", power: "Pulse el botón de encendido para iniciar el analizador.", wbc: "El recuento de WBC está elevado." },
  French: { code: "fr", manufacturer: "Fabricant", address: "Adresse", ecRep: "Représentant dans l’UE", power: "Appuyez sur le bouton d’alimentation pour démarrer l’analyseur.", wbc: "Le nombre de WBC est élevé." },
  German: { code: "de", manufacturer: "Hersteller", address: "Adresse", ecRep: "EU-Bevollmächtigter", power: "Drücken Sie die Ein-/Aus-Taste, um das Analysegerät zu starten.", wbc: "Die WBC-Zahl ist erhöht." },
  Italian: { code: "it", manufacturer: "Produttore", address: "Indirizzo", ecRep: "Rappresentante UE", power: "Premere il pulsante di accensione per avviare l’analizzatore.", wbc: "La conta dei WBC è elevata." },
  Polish: { code: "pl", manufacturer: "Producent", address: "Adres", ecRep: "Przedstawiciel w UE", power: "Naciśnij przycisk zasilania, aby uruchomić analizator.", wbc: "Liczba WBC jest podwyższona." },
  Romanian: { code: "ro", manufacturer: "Producător", address: "Adresă", ecRep: "Reprezentant UE", power: "Apăsați butonul de pornire pentru a porni analizorul.", wbc: "Numărul de WBC este crescut." },
  Turkish: { code: "tr", manufacturer: "Üretici", address: "Adres", ecRep: "AB temsilcisi", power: "Analizörü başlatmak için güç düğmesine basın.", wbc: "WBC sayısı yüksek." },
  Russian: { code: "ru", manufacturer: "Производитель", address: "Адрес", ecRep: "Представитель в ЕС", power: "Нажмите кнопку питания, чтобы запустить анализатор.", wbc: "Количество WBC повышено." },
  Portuguese: { code: "pt", manufacturer: "Fabricante", address: "Endereço", ecRep: "Representante na UE", power: "Pressione o botão de energia para iniciar o analisador.", wbc: "A contagem de WBC está elevada." }
};

const isChinese = (lang) => LANGS[lang].code.startsWith("zh");
const colon = (lang) => (isChinese(lang) ? "：" : lang === "French" ? " : " : ": ");

// Text that policy allows to stay verbatim in any target language.
const KEPT = {
  company_name: [
    "Hunan Ehome Health Technology Co., Ltd.",
    "Shenzhen Mindray Bio-Medical Electronics Co., Ltd.",
    "Riomavix S.L.",
    "Lotus NL B.V.",
    "Sysmex Corporation",
    "Medical Device Safety Service GmbH"
  ],
  company_name_zh: ["湖南伊鸿健康科技有限公司"],
  address_block: [
    "Room 103 and 104, No.13 Building, Country Garden Wisdom Garden, Xueshi Street, Yuelu District, Changsha, Hunan, P. R. China",
    "Room 301/401(II), No.3 Building, Liandong U Valley Industrial Park, No.32 Yulian Road, Changsha, Hunan, P.R. China",
    "Calle de Almansa 55, 28039 Madrid, Spain",
    "Koningin Julianaplein 10, 2595AA The Hague, Netherlands",
    "Schiffgraben 41, 30175 Hannover, Germany"
  ],
  contact: [
    "service@ehome-health.com",
    "www.ehomehealth.com",
    "https://www.ehomehealth.com/support",
    "+86-731-88888888"
  ],
  fixed_expression: ["Rx only", "EC REP", "IVD", "REF", "LOT", "CE 0123"],
  locked_code: ["EHBT-75", "YH-QC500", "WBC", "NST/WBC%", "10^9/L", "≤65 dBA", "AC 100-240V 50/60Hz", "EN 61010-1:2010+A1:2019"]
};

const cases = [];
const add = (c) => cases.push({ schema: "poct.rule_golden_case.v1", ...c });

for (const lang of Object.keys(LANGS)) {
  const L = LANGS[lang];

  // 1. Kept verbatim as the whole segment -> pass.
  for (const [category, items] of Object.entries(KEPT)) {
    if (category === "company_name_zh") continue;
    items.forEach((text, i) => {
      add({ id: `${L.code}-kept-${category}-${i + 1}`, targetLang: lang, category, sourceText: text, translatedText: text, expect: "pass", origin: "template" });
    });
  }

  // 2. Translated label + kept entity -> pass.
  KEPT.company_name.slice(0, 3).forEach((name, i) => {
    add({ id: `${L.code}-label-company-${i + 1}`, targetLang: lang, category: "company_name", sourceText: `Manufacturer: ${name}`, translatedText: `${L.manufacturer}${colon(lang)}${name}`, expect: "pass", origin: "template" });
  });
  KEPT.address_block.slice(0, 3).forEach((addr, i) => {
    add({ id: `${L.code}-label-address-${i + 1}`, targetLang: lang, category: "address_block", sourceText: `Address: ${addr}`, translatedText: `${L.address}${colon(lang)}${addr}`, expect: "pass", origin: "template" });
  });
  add({ id: `${L.code}-label-ecrep`, targetLang: lang, category: "address_block", sourceText: "EC REP: Riomavix S.L., Calle de Almansa 55, 28039 Madrid, Spain", translatedText: `${L.ecRep}${colon(lang)}Riomavix S.L., Calle de Almansa 55, 28039 Madrid, Spain`, expect: "pass", origin: "template" });
  add({ id: `${L.code}-label-email`, targetLang: lang, category: "contact", sourceText: "E-mail: service@ehome-health.com", translatedText: `E-mail${colon(lang)}service@ehome-health.com`, expect: "pass", origin: "template" });

  // 3. Chinese legal name kept in any target -> pass (it is on the do-not-translate list).
  add({ id: `${L.code}-kept-company_name_zh-1`, targetLang: lang, category: "company_name", sourceText: KEPT.company_name_zh[0], translatedText: KEPT.company_name_zh[0], expect: "pass", origin: "template" });

  // 4. Correct translation of normal prose -> pass (control: rules must not flag good output).
  add({ id: `${L.code}-prose-correct-1`, targetLang: lang, category: "prose_translated", sourceText: "按下电源键启动分析仪。", translatedText: L.power, expect: "pass", origin: "template" });
  add({ id: `${L.code}-prose-correct-2`, targetLang: lang, category: "prose_translated", sourceText: "WBC 计数升高。", translatedText: L.wbc, expect: "pass", origin: "template" });

  // 5. Normal prose left in the source language -> flag.
  if (!isChinese(lang)) {
    add({ id: `${L.code}-prose-untranslated-zh`, targetLang: lang, category: "prose_untranslated", sourceText: "按下电源键启动分析仪。", translatedText: "按下电源键启动分析仪。", expect: "flag", expectTypes: ["chinese", "nonTargetLanguage"], origin: "template" });
  }
  if (lang !== "English") {
    add({ id: `${L.code}-prose-untranslated-en`, targetLang: lang, category: "prose_untranslated", sourceText: "Press the power button to start the analyzer.", translatedText: "Press the power button to start the analyzer.", expect: "flag", expectTypes: ["nonTargetLanguage"], origin: "template" });
  } else {
    add({ id: `${L.code}-prose-untranslated-ru`, targetLang: lang, category: "prose_untranslated", sourceText: "Нажмите кнопку питания, чтобы запустить анализатор.", translatedText: "Нажмите кнопку питания, чтобы запустить анализатор.", expect: "flag", expectTypes: ["nonTargetLanguage"], origin: "template" });
  }

  // 6. Mechanical damage -> flag.
  add({ id: `${L.code}-placeholder-leak`, targetLang: lang, category: "placeholder_broken", sourceText: "WBC 计数升高。", translatedText: `${L.wbc} __TKN_0__`, expect: "flag", expectTypes: ["placeholders"], origin: "template" });
  add({ id: `${L.code}-medical-code-lost`, targetLang: lang, category: "locked_code_changed", sourceText: "WBC 计数升高。", translatedText: L.wbc.replace("WBC", isChinese(lang) ? "白细胞" : "leuco"), expect: "flag", expectTypes: ["placeholders"], origin: "template" });
  add({ id: `${L.code}-model-id-changed`, targetLang: lang, category: "locked_code_changed", sourceText: "YH-HC500", translatedText: "YH-HC 500", expect: "flag", expectTypes: ["idMismatch"], origin: "template" });
  add({ id: `${L.code}-empty`, targetLang: lang, category: "empty_translation", sourceText: "按下电源键启动分析仪。", translatedText: "", expect: "flag", expectTypes: ["emptyTranslations"], origin: "template" });

  // 6b. Missed errors found in the 2026-10-14 audit -> flag. Each has a "pass" twin below so the
  //     fix cannot simply tighten everything.
  if (!isChinese(lang)) {
    // Chinese prose that merely ends in a company name is still untranslated prose.
    add({ id: `${L.code}-cjk-sentence-with-company`, targetLang: lang, category: "prose_untranslated", sourceText: "请联系深圳市某某医疗有限公司获取帮助", translatedText: "请联系深圳市某某医疗有限公司", expect: "flag", expectTypes: ["chinese", "nonTargetLanguage"], origin: "audit-2026-10-14" });
    add({ id: `${L.code}-label-company-zh`, targetLang: lang, category: "company_name", sourceText: "制造商：湖南伊鸿健康科技有限公司", translatedText: `${L.manufacturer}${colon(lang)}湖南伊鸿健康科技有限公司`, expect: "pass", origin: "audit-2026-10-14" });
  }
  if (lang !== "English") {
    // Ordinary English words that also occur in address names are not protected terms.
    add({ id: `${L.code}-common-words-untranslated`, targetLang: lang, category: "prose_untranslated", sourceText: "Park the analyzer on a smart, level surface away from the garden.", translatedText: "Park the analyzer on a smart, level surface away from the garden.", expect: "flag", expectTypes: ["nonTargetLanguage"], origin: "audit-2026-10-14" });
  }
  // Code words must survive translation unchanged.
  const portsSource = "接口 USB2 RS232 COM1 COM2 LAN1 LAN2 HDMI1 HDMI2 RS485 DC12 DC24 可用";
  const portsTarget = (codes) => `${L.wbc.split(/\s/)[0]} ${codes}`;
  add({ id: `${L.code}-codes-kept-11`, targetLang: lang, category: "locked_code", sourceText: portsSource, translatedText: portsTarget("USB2 RS232 COM1 COM2 LAN1 LAN2 HDMI1 HDMI2 RS485 DC12 DC24"), expect: "pass", origin: "audit-2026-10-14" });
  add({ id: `${L.code}-codes-lost-11`, targetLang: lang, category: "locked_code_changed", sourceText: portsSource, translatedText: portsTarget("USB2 RS232 COM1 COM2 LAN1 LAN2 HDMI1 HDMI2 RS485 DC12 RS2320__"), expect: "flag", expectTypes: ["idMismatch", "placeholders"], origin: "audit-2026-10-14" });
  add({ id: `${L.code}-codes-kept-analytes`, targetLang: lang, category: "locked_code", sourceText: "SpO2、HbA1c、IPX4、CO2", translatedText: "SpO2, HbA1c, IPX4, CO2", expect: "pass", origin: "audit-2026-10-14" });
  add({ id: `${L.code}-codes-split-analytes`, targetLang: lang, category: "locked_code_changed", sourceText: "SpO2、HbA1c、IPX4、CO2", translatedText: "SpO 2, HbA 1 c, IPX 4, CO 2", expect: "flag", expectTypes: ["idMismatch"], origin: "audit-2026-10-14" });
  add({ id: `${L.code}-units-respaced`, targetLang: lang, category: "locked_code", sourceText: "加入10mL样本", translatedText: `${L.wbc.split(/\s/)[0]} 10 mL`, expect: "pass", origin: "audit-2026-10-14" });

  // 7. Policy-ambiguous: address with generic words half kept, half translated.
  if (lang === "Russian") {
    add({ id: `${L.code}-address-half-kept`, targetLang: lang, category: "address_mixed", sourceText: "Address: Room 103, Xueshi Street, Yuelu District, Changsha, Hunan, China", translatedText: "Адрес: комната 103, Xueshi Street, Yuelu District, Changsha, Hunan, Китай", expect: "either", origin: "template" });
  }
}

// Language-specific typography that is correct, not a spacing error.
add({ id: "fr-typography-colon", targetLang: "French", category: "typography", sourceText: "Website: www.ehomehealth.com", translatedText: "Site web : www.ehomehealth.com", expect: "pass", origin: "template" });
add({ id: "fr-typography-question", targetLang: "French", category: "typography", sourceText: "Continue?", translatedText: "Continuer ?", expect: "pass", origin: "template" });
add({ id: "en-glue-real", targetLang: "English", category: "spacing_broken", sourceText: "连接电源线。", translatedText: "Connectthe power cable.", expect: "flag", expectTypes: ["spacing"], origin: "template" });

// Pairs taken from real quality reports (local-data, 2026-05) with their correct verdicts.
add({ id: "real-ru-a4-split", targetLang: "Russian", category: "spacing_broken", sourceText: "A4 printer connection", translatedText: "Подключение принтера A 4", expect: "flag", expectTypes: ["spacing"], origin: "real-report" });
add({ id: "real-ru-ieee-split", targetLang: "Russian", category: "spacing_broken", sourceText: "Meet IEEE 802.11b/g/n standards", translatedText: "Соответствует стандартам IEEE 802. 11 b/g/n", expect: "flag", expectTypes: ["spacing"], origin: "real-report" });
add({ id: "real-es-temperature", targetLang: "Spanish", category: "locked_code", sourceText: "Storage temperature: -20°C to 55°C.", translatedText: "Temperatura de almacenamiento: de -20 °C a 55 °C.", expect: "pass", origin: "real-report" });
add({ id: "real-ru-display-mode", targetLang: "Russian", category: "prose_untranslated", sourceText: "Display mode", translatedText: "Display mode", expect: "flag", expectTypes: ["nonTargetLanguage"], origin: "real-report" });
add({ id: "real-ru-dc-interface", targetLang: "Russian", category: "prose_untranslated", sourceText: "Connect the power adapter to the DC power interface on the back.", translatedText: "Подключите адаптер питания к разъему питания DC power interface на задней панели.", expect: "flag", expectTypes: ["nonTargetLanguage"], origin: "real-report" });
add({ id: "real-ru-address-kept", targetLang: "Russian", category: "address_block", sourceText: "Manufacturer Address: Room 103 and 104, No.13 Building, Country Garden Wisdom Garden, Xueshi Street, Yuelu District, Changsha, Hunan, P. R. China", translatedText: "Адрес производителя: Room 103 and 104, No.13 Building, Country Garden Wisdom Garden, Xueshi Street, Yuelu District, Changsha, Hunan, P. R. China", expect: "pass", origin: "real-report" });
add({ id: "real-es-warranty", targetLang: "Spanish", category: "prose_translated", sourceText: "This analyzer comes with a standard 1-year warranty.", translatedText: "Este analizador cuenta con una garantía estándar de 1 año.", expect: "pass", origin: "real-report" });

fs.writeFileSync(outPath, cases.map((c) => JSON.stringify(c)).join("\n") + "\n");
console.log(`Wrote ${cases.length} cases to ${path.relative(repoRoot, outPath)}`);
