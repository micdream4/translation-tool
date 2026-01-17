import {
  ClinicalRule,
  MissingCombination,
  POCTRecord,
  RuleCondition
} from "../types";
import { CLINICAL_COMBO_LIBRARY } from "../data/clinicalCombos";

const POSSIBLE_RULE_KEYS = [
  "Rule",
  "组合",
  "条件",
  "触发条件",
  "逻辑",
  "Combination"
];

const POSSIBLE_EXPLANATION_KEYS = [
  "Conclusion",
  "结论",
  "解读",
  "Result",
  "解释",
  "Interpretation"
];

export class RuleEngine {
  extractRules(records: POCTRecord[], sheetName?: string): ClinicalRule[] {
    return records.map((row, idx) => {
      const description = this.findFirstValue(row, POSSIBLE_RULE_KEYS);
      const explanation = this.findFirstValue(row, POSSIBLE_EXPLANATION_KEYS);
      return {
        id: String(row.id || row.ID || row["编号"] || `rule-${idx + 1}`),
        sheet: sheetName,
        description: description || "",
        explanation: explanation || "",
        severity: this.deriveSeverity(row, explanation),
        conditions: this.deriveConditions(description),
        raw: row
      };
    });
  }

  detectMissingCombinations(rules: ClinicalRule[]): MissingCombination[] {
    const matchedTemplates = new Set<string>();
    const normalizedRules = rules.map((rule) => ({
      rule,
      text: `${rule.description ?? ""} ${rule.explanation ?? ""}`
        .toLowerCase()
        .replace(/\s+/g, " ")
    }));

    CLINICAL_COMBO_LIBRARY.forEach((template) => {
      if (template.status === "discarded") return;
      const isCovered = normalizedRules.some(({ rule, text }) =>
        this.templateMatchesRule(template, text, rule)
      );
      if (isCovered) {
        matchedTemplates.add(template.id);
      }
    });

    return CLINICAL_COMBO_LIBRARY.filter(
      (template) => template.status !== "discarded" && !matchedTemplates.has(template.id)
    ).map((template) => ({
      id: `missing-${template.id}`,
      templateId: template.id,
      indicator: template.title,
      suggestion: template.summary,
      severity: template.severity,
      status: "suggested",
      basis: template.evidence ?? []
    }));
  }

  private deriveSeverity(row: POCTRecord, explanation?: string) {
    const raw =
      String(row.severity || row["级别"] || row["等级"] || "").toLowerCase() ||
      String(explanation || "").toLowerCase();
    if (/危|critical|严重/.test(raw)) return "critical";
    if (/警|warning|需关注/.test(raw)) return "warning";
    return "normal";
  }

  private deriveConditions(description?: string): RuleCondition[] {
    if (!description) return [];
    const normalized = description.replace(/[（）]/g, (ch) =>
      ch === "（" ? "(" : ")"
    );
    const indicators: RuleCondition[] = [];
    normalized.split(/[,;；、]/).forEach((segment) => {
      const trimmed = segment.trim();
      if (!trimmed) return;
      const matched = trimmed.match(/^([A-Za-z\u4e00-\u9fa5]+)\s*(↑|↓|高|低|异常|=|正常)?/);
      if (matched) {
        const [, indicator, opSymbol] = matched;
        indicators.push({
          indicator,
          operator: this.normalizeOperator(opSymbol),
          value: opSymbol || "status"
        });
      }
    });
    return indicators;
  }

  private normalizeOperator(symbol?: string): RuleCondition["operator"] {
    if (!symbol) return "status";
    if (symbol === "↑" || /高/.test(symbol)) return ">";
    if (symbol === "↓" || /低/.test(symbol)) return "<";
    if (symbol === "=" || /正常/.test(symbol)) return "=";
    return "status";
  }

  private findFirstValue(row: POCTRecord, keys: string[]) {
    for (const key of keys) {
      if (row[key] !== undefined) return String(row[key]);
    }
    return undefined;
  }

  private templateMatchesRule(
    template: (typeof CLINICAL_COMBO_LIBRARY)[number],
    normalizedText: string,
    rule: ClinicalRule
  ) {
    const indicatorSatisfied = template.indicators.every((pattern) => {
      const aliasHit = pattern.aliases.some((alias) =>
        normalizedText.includes(alias.toLowerCase())
      );
      if (aliasHit) return true;
      return rule.conditions.some((condition) => {
        const normalizedIndicator = condition.indicator.toLowerCase();
        const matchesIndicator = pattern.aliases.some((alias) =>
          normalizedIndicator.includes(alias.toLowerCase())
        );
        if (!matchesIndicator) return false;
        if (!pattern.operator) return true;
        if (!condition.operator) return true;
        return pattern.operator === condition.operator;
      });
    });

    if (!indicatorSatisfied) return false;

    if (template.keywords && template.keywords.length > 0) {
      return template.keywords.some((kw) =>
        normalizedText.includes(kw.toLowerCase())
      );
    }
    return true;
  }
}
