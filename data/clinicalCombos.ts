import { CombinationTemplate } from "../types";

export const CLINICAL_COMBO_LIBRARY: CombinationTemplate[] = [
  {
    id: "combo-wbc-neu-high",
    title: "白细胞 & 中性粒升高（疑似细菌感染）",
    summary:
      "当 WBC 与中性粒细胞（NEU）同步升高时，多提示急性细菌感染或强烈炎症反应，应结合发热、CRP 等指标进一步排查。",
    severity: "warning",
    indicators: [
      {
        indicator: "WBC",
        aliases: ["WBC", "白细胞"],
        operator: ">"
      },
      {
        indicator: "NEU",
        aliases: ["NEU", "中性粒", "中性粒细胞"],
        operator: ">"
      }
    ],
    keywords: ["感染", "bacterial"],
    evidence: ["《血液学诊断手册》2023 第 4 章"],
    status: "active"
  },
  {
    id: "combo-wbc-lym-low",
    title: "白细胞降低 + 淋巴细胞降低（骨髓抑制/病毒性抑制）",
    summary:
      "WBC、LYM 同步下降时需警惕骨髓造血抑制、抗肿瘤化疗后抑制或重症病毒感染的恢复期。",
    severity: "critical",
    indicators: [
      {
        indicator: "WBC",
        aliases: ["WBC", "白细胞"],
        operator: "<"
      },
      {
        indicator: "LYM",
        aliases: ["LYM", "淋巴"],
        operator: "<"
      }
    ],
    keywords: ["抑制", "suppression"],
    evidence: ["骨髓增生异常综合征诊疗指南 2022"],
    status: "active"
  },
  {
    id: "combo-rbc-hgb-low",
    title: "红细胞 & 血红蛋白降低（贫血提示）",
    summary:
      "RBC、HGB 明显低于参考范围通常代表贫血，应提示铁缺乏、慢性肾病、失血等病因评估。",
    severity: "warning",
    indicators: [
      {
        indicator: "RBC",
        aliases: ["RBC", "红细胞"],
        operator: "<"
      },
      {
        indicator: "HGB",
        aliases: ["HGB", "血红蛋白", "Hb"],
        operator: "<"
      }
    ],
    keywords: ["贫血", "anemia"],
    evidence: ["《贫血诊断与治疗专家共识》2021"],
    status: "active"
  },
  {
    id: "combo-plt-low",
    title: "血小板显著降低（血小板减少症）",
    summary:
      "PLT 低于 100×10^9/L 时提示出血风险，需结合 DIC、免疫性血小板减少等病因。",
    severity: "critical",
    indicators: [
      {
        indicator: "PLT",
        aliases: ["PLT", "血小板"],
        operator: "<"
      }
    ],
    keywords: ["出血", "thrombocytopenia"],
    evidence: ["ITP 治疗中国指南 2022"],
    status: "active"
  },
  {
    id: "combo-lym-high",
    title: "淋巴细胞升高（病毒感染可能）",
    summary:
      "LYM 升高伴 WBC 正常或轻度升高，多见于病毒感染、百日咳等，应提示结合病史。",
    severity: "normal",
    indicators: [
      {
        indicator: "LYM",
        aliases: ["LYM", "淋巴"],
        operator: ">"
      }
    ],
    keywords: ["病毒", "viral"],
    evidence: ["急性感染诊疗规范 2020"],
    status: "active"
  },
  {
    id: "combo-eos-high",
    title: "嗜酸粒升高（过敏/寄生虫）",
    summary:
      "EOS 持续升高多与过敏反应、寄生虫感染或某些自身免疫疾病相关，需结合症状确认。",
    severity: "normal",
    indicators: [
      {
        indicator: "EOS",
        aliases: ["EOS", "嗜酸", "嗜酸细胞"],
        operator: ">"
      }
    ],
    keywords: ["过敏", "allergy"],
    evidence: ["嗜酸粒细胞增多诊治专家共识 2019"],
    status: "active"
  },
  {
    id: "combo-mono-high",
    title: "单核细胞升高（慢性感染或恢复期）",
    summary:
      "MONO 升高可提示慢性炎性疾病或骨髓恢复期，应提示结合 ESR、CRP。",
    severity: "warning",
    indicators: [
      {
        indicator: "MONO",
        aliases: ["MONO", "单核"],
        operator: ">"
      }
    ],
    keywords: ["慢性", "chronic"],
    evidence: ["慢性感染诊疗建议 2021"],
    status: "active"
  },
  {
    id: "combo-hct-high",
    title: "红细胞压积升高（真性红细胞增多）",
    summary:
      "RBC、HCT 同步升高时应警惕真性红细胞增多症或慢性低氧状态，需进一步检查 JAK2。",
    severity: "warning",
    indicators: [
      {
        indicator: "RBC",
        aliases: ["RBC", "红细胞"],
        operator: ">"
      },
      {
        indicator: "HCT",
        aliases: ["HCT", "红细胞压积"],
        operator: ">"
      }
    ],
    keywords: ["增多", "polycythemia"],
    evidence: ["真性红细胞增多症诊疗中国指南 2021"],
    status: "active"
  }
];
