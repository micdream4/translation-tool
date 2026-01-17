export interface GlossaryEntry {
  /**
   * Terms that appear in the source (mostly Chinese) and should trigger enforcing the preferred wording.
   */
  keywords: string[];
  /**
   * Preferred translation we want to surface.
   */
  preferred: string;
  /**
   * Optional English variants that might appear in the translated sentence
   * (e.g. "Service Life") and should be normalized to the preferred wording.
   */
  variants?: string[];
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    keywords: ["全自动血液分析仪", "自动血液分析仪"],
    preferred: "Automated Hematology Analyzer"
  },
  {
    keywords: ["血液分析系统", "血液分析仪器"],
    preferred: "Hematology System"
  },
  {
    keywords: ["体外诊断设备", "体外诊断仪器"],
    preferred: "In Vitro Diagnostic (IVD) Device"
  },
  {
    keywords: ["光学单元"],
    preferred: "Optical Unit"
  },
  {
    keywords: ["光电模组"],
    preferred: "Photoelectric Module"
  },
  {
    keywords: ["显微镜头相机模组", "显微相机模组"],
    preferred: "Microscopic Camera Module"
  },
  {
    keywords: ["载物台移动模块"],
    preferred: "Stage Movement Module"
  },
  {
    keywords: ["自动加样模块"],
    preferred: "Automated Sampling Module"
  },
  {
    keywords: ["移液器组件"],
    preferred: "Pipettor Assembly"
  },
  {
    keywords: ["计数板", "计数室"],
    preferred: "Counting Chamber"
  },
  {
    keywords: ["朗伯-比尔定律", "比尔朗伯定律"],
    preferred: "Beer-Lambert Law"
  },
  {
    keywords: ["柱塞泵"],
    preferred: "Plunger Pump"
  },
  {
    keywords: ["电磁兼容性"],
    preferred: "Electromagnetic Compatibility (EMC)"
  },
  {
    keywords: ["血常规检测", "血常规"],
    preferred: "Complete Blood Count (CBC)"
  },
  {
    keywords: ["白细胞"],
    preferred: "White Blood Cell (WBC)"
  },
  {
    keywords: ["异常淋巴细胞", "异形淋巴细胞", "非典型淋巴细胞"],
    preferred: "Atypical Lymphocytes (ALY#)",
    variants: [
      "Atypical granulocytes",
      "Immature granulocytes",
      "Atypical granulocytes (ALY#)",
      "Immature granulocytes (ALY#)",
      "granulocytes (ALY#)"
    ]
  },
  {
    keywords: ["红细胞"],
    preferred: "Red Blood Cell (RBC)"
  },
  {
    keywords: ["网织红细胞"],
    preferred: "Reticulocytes",
    variants: ["Reticulocyte", "reticulocytes", "reticulocyte"]
  },
  {
    keywords: ["网织红细胞比率", "网织红细胞比例", "网织红细胞率"],
    preferred: "Reticulocyte Percentage",
    variants: ["Reticulocyte Ratio", "Reticulocyte percent", "Reticulocyte percentage"]
  },
  {
    keywords: ["网织红细胞计数"],
    preferred: "Reticulocyte Count",
    variants: ["Reticulocyte count"]
  },
  {
    keywords: ["影红细胞"],
    preferred: "Ghost Cells",
    variants: ["Ghost cells", "Ghost RBCs", "Ghost red blood cells"]
  },
  {
    keywords: ["球形红细胞增多症"],
    preferred: "Spherocytosis",
    variants: ["spherocytosis"]
  },
  {
    keywords: ["球形红细胞"],
    preferred: "Spherocytes",
    variants: ["Spherocyte", "spherocytes", "spherocyte"]
  },
  {
    keywords: ["血小板"],
    preferred: "Platelet (PLT)"
  },
  {
    keywords: ["血红蛋白"],
    preferred: "Hemoglobin (HGB)"
  },
  {
    keywords: ["血红蛋白浓度"],
    preferred: "Hemoglobin Concentration",
    variants: ["Hemoglobin concentration"]
  },
  {
    keywords: ["血红蛋白含量"],
    preferred: "Hemoglobin Content",
    variants: ["Hemoglobin content"]
  },
  {
    keywords: ["平均红细胞血红蛋白含量"],
    preferred: "Mean Corpuscular Hemoglobin (MCH)",
    variants: ["Mean Corpuscular Hemoglobin", "MCH"]
  },
  {
    keywords: ["平均红细胞血红蛋白浓度"],
    preferred: "Mean Corpuscular Hemoglobin Concentration (MCHC)",
    variants: ["Mean Corpuscular Hemoglobin Concentration", "MCHC"]
  },
  {
    keywords: ["平均红细胞体积"],
    preferred: "Mean Corpuscular Volume (MCV)"
  },
  {
    keywords: ["红细胞压积"],
    preferred: "Hematocrit (HCT)",
    variants: ["Hematocrit", "HCT"]
  },
  {
    keywords: ["红细胞生成素", "促红细胞生成素"],
    preferred: "Erythropoietin (EPO)",
    variants: ["Erythropoietin", "EPO"]
  },
  {
    keywords: ["血液浓缩"],
    preferred: "Hemoconcentration",
    variants: ["hemoconcentration"]
  },
  {
    keywords: ["溶血"],
    preferred: "Hemolysis",
    variants: ["hemolysis"]
  },
  {
    keywords: ["血管内溶血"],
    preferred: "Intravascular Hemolysis",
    variants: ["intravascular hemolysis"]
  },
  {
    keywords: ["血管外溶血"],
    preferred: "Extravascular Hemolysis",
    variants: ["extravascular hemolysis"]
  },
  {
    keywords: ["混合性溶血"],
    preferred: "Mixed Hemolysis",
    variants: ["mixed hemolysis"]
  },
  {
    keywords: ["溶血性贫血"],
    preferred: "Hemolytic Anemia",
    variants: ["hemolytic anemia"]
  },
  {
    keywords: ["自身免疫性溶血性贫血"],
    preferred: "Autoimmune Hemolytic Anemia",
    variants: ["autoimmune hemolytic anemia"]
  },
  {
    keywords: ["免疫介导性溶血性贫血"],
    preferred: "Immune-Mediated Hemolytic Anemia (IMHA)",
    variants: ["Immune-mediated hemolytic anemia", "IMHA"]
  },
  {
    keywords: ["巨幼红细胞性贫血"],
    preferred: "Megaloblastic Anemia",
    variants: ["megaloblastic anemia"]
  },
  {
    keywords: ["大细胞性贫血"],
    preferred: "Macrocytic Anemia",
    variants: ["macrocytic anemia"]
  },
  {
    keywords: ["大红细胞增多症"],
    preferred: "Macrocytosis",
    variants: ["macrocytosis"]
  },
  {
    keywords: ["小细胞性贫血"],
    preferred: "Microcytic Anemia",
    variants: ["microcytic anemia"]
  },
  {
    keywords: ["小细胞低色素性贫血"],
    preferred: "Microcytic Hypochromic Anemia",
    variants: ["microcytic hypochromic anemia"]
  },
  {
    keywords: ["缺铁性贫血"],
    preferred: "Iron Deficiency Anemia",
    variants: ["iron deficiency anemia"]
  },
  {
    keywords: ["慢性失血性贫血"],
    preferred: "Chronic Hemorrhagic Anemia",
    variants: ["chronic hemorrhagic anemia"]
  },
  {
    keywords: ["急性失血性贫血"],
    preferred: "Acute Hemorrhagic Anemia",
    variants: ["acute hemorrhagic anemia"]
  },
  {
    keywords: ["营养性贫血"],
    preferred: "Nutritional Anemia",
    variants: ["nutritional anemia"]
  },
  {
    keywords: ["再生障碍性贫血"],
    preferred: "Aplastic Anemia",
    variants: ["aplastic anemia"]
  },
  {
    keywords: ["遗传性球形红细胞增多症"],
    preferred: "Hereditary Spherocytosis",
    variants: ["hereditary spherocytosis"]
  },
  {
    keywords: ["骨髓增生异常综合征"],
    preferred: "Myelodysplastic Syndrome (MDS)",
    variants: ["myelodysplastic syndrome", "MDS"]
  },
  {
    keywords: ["真性红细胞增多症"],
    preferred: "Polycythemia Vera",
    variants: ["polycythemia vera"]
  },
  {
    keywords: ["直方图"],
    preferred: "Histogram"
  },
  {
    keywords: ["抗凝剂"],
    preferred: "Anticoagulant (EDTA)"
  },
  {
    keywords: ["静脉血"],
    preferred: "Venous Blood"
  },
  {
    keywords: ["末梢血"],
    preferred: "Capillary Blood"
  },
  {
    keywords: ["有形成分"],
    preferred: "Formed Elements"
  },
  {
    keywords: ["生物危害", "潜在传染物"],
    preferred: "Biohazard"
  },
  {
    keywords: ["耗材"],
    preferred: "Consumables"
  },
  {
    keywords: ["试剂盒"],
    preferred: "Reagent Kit"
  },
  {
    keywords: ["批次号"],
    preferred: "Lot Number"
  },
  {
    keywords: ["校准系数", "校准"],
    preferred: "Calibration Factor"
  },
  {
    keywords: ["质控品", "质控"],
    preferred: "Quality Control (QC)"
  },
  {
    keywords: ["靶值"],
    preferred: "Target Value"
  },
  {
    keywords: ["标准差"],
    preferred: "Standard Deviation (SD)"
  },
  {
    keywords: ["变异系数"],
    preferred: "Coefficient of Variation (CV)"
  },
  {
    keywords: ["LJ质控图"],
    preferred: "Levey-Jennings Chart"
  },
  {
    keywords: ["LIS连接"],
    preferred: "LIS Connection"
  },
  {
    keywords: ["样本前处理"],
    preferred: "Sample Pre-processing"
  },
  {
    keywords: ["参考范围"],
    preferred: "Reference Range"
  },
  {
    keywords: ["复测", "重新测试"],
    preferred: "Rerun"
  },
  {
    keywords: ["使用寿命", "寿命"],
    preferred: "Lifetime",
    variants: ["Service Life", "Service Lifetime", "Analyzer Service Life"]
  },
  {
    keywords: ["DC接口"],
    preferred: "DC Port",
    variants: ["DC Interface", "DC interface"]
  },
  {
    keywords: ["USB接口"],
    preferred: "USB Port",
    variants: ["USB Interface", "USB interface"]
  },
  {
    keywords: ["EH-BUS接口"],
    preferred: "EH-BUS Port",
    variants: ["EH-BUS Interface", "EH-BUS interface"]
  }
];

const escapeRegExp = (value: string) =>
  value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

const isWordLike = (value: string) => /^[A-Za-z0-9 ]+$/.test(value);

const shouldEnforce = (original: string, keywords: string[]) => {
  if (!original || !keywords.length) return false;
  return keywords.some((keyword) => keyword && original.includes(keyword));
};

export const enforceGlossary = (original: string, translated: string) => {
  if (!original || !translated) return translated;
  const variantMap = new Map<string, { preferred: string; variant: string }>();

  GLOSSARY.forEach((entry) => {
    if (!shouldEnforce(original, entry.keywords)) {
      return;
    }
    const variants = new Set<string>();
    entry.keywords.forEach((keyword) => variants.add(keyword));
    (entry.variants || []).forEach((variant) => variants.add(variant));
    variants.add(entry.preferred);

    variants.forEach((variant) => {
      if (!variant) return;
      const key = variant.toLowerCase();
      if (!variantMap.has(key)) {
        variantMap.set(key, { preferred: entry.preferred, variant });
      }
    });
  });

  if (variantMap.size === 0) return translated;

  const patterns = Array.from(variantMap.values())
    .sort((a, b) => b.variant.length - a.variant.length)
    .map(({ variant }) => {
      const escaped = escapeRegExp(variant);
      if (isWordLike(variant)) {
        return `\\b${escaped}\\b`;
      }
      return escaped;
    });

  const regex = new RegExp(patterns.join("|"), "gi");
  return translated.replace(regex, (match) => {
    const entry = variantMap.get(match.toLowerCase());
    return entry ? entry.preferred : match;
  });
};

export const GLOSSARY_PROMPT = GLOSSARY.map((entry) => {
  const source = entry.keywords[0] || "";
  return `${source} -> ${entry.preferred}`;
}).join("\n");
