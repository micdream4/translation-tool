import {
  ClinicalRule,
  CrossCheckConclusion,
  CrossCheckResult
} from "../types";
import { CLINICAL_COMBO_LIBRARY } from "../data/clinicalCombos";

interface CrossCheckOptions {
  maxItems?: number;
}

export class MultiAIJudge {
  private readonly openRouterKey?: string;
  private readonly deepseekKey?: string;

  constructor() {
    this.openRouterKey = this.resolveEnvKey([
      "OPENROUTER_API_KEY",
      "VITE_OPENROUTER_API_KEY",
      "Openrouter_API_KEY",
      "VITE_Openrouter_API_KEY"
    ]);
    this.deepseekKey = this.resolveEnvKey([
      "VITE_DEEPSEEK_API_KEY",
      "DEEPSEEK_API_KEY",
      "Deepseek_API_KEY"
    ]);
  }

  async crossValidate(
    rules: ClinicalRule[],
    options: CrossCheckOptions = {}
  ): Promise<CrossCheckResult[]> {
    const limit = options.maxItems ?? rules.length;
    const targets = rules.slice(0, limit);
    const outputs: CrossCheckResult[] = [];
    for (const rule of targets) {
      outputs.push(await this.evaluateRule(rule));
    }
    return outputs;
  }

  private async evaluateRule(rule: ClinicalRule): Promise<CrossCheckResult> {
    const heuristic = this.buildHeuristicConclusion(rule);
    const conclusions: CrossCheckConclusion[] = [heuristic.conclusion];
    const conflicts: string[] = [];

    const openRouterText = await this.queryOpenRouter(rule, heuristic.template).catch(
      (err) => {
        console.warn("OpenRouter insight failed:", err);
        return null;
      }
    );
    if (openRouterText) {
      const classification = this.classifyTheme(openRouterText);
      conclusions.push({
        model: "OpenRouter",
        text: openRouterText,
        confidence: this.estimateConfidence(openRouterText)
      });
      conflicts.push(
        ...this.detectConflict(heuristic.theme, classification, "OpenRouter")
      );
    }

    const deepseekText = await this.queryDeepseek(rule, heuristic.template).catch(
      (err) => {
        console.warn("Deepseek insight failed:", err);
        return null;
      }
    );
    if (deepseekText) {
      const classification = this.classifyTheme(deepseekText);
      conclusions.push({
        model: "Deepseek",
        text: deepseekText,
        confidence: this.estimateConfidence(deepseekText)
      });
      conflicts.push(
        ...this.detectConflict(heuristic.theme, classification, "Deepseek")
      );
    }

    const aggregatedSummary = this.composeAggregate(conclusions);
    const finalRecommendation =
      conflicts.length > 0
        ? `检测到 ${conflicts.length} 个冲突，请人工复核（${conflicts.join(
            "；"
          )}）。`
        : heuristic.recommendation;

    return {
      ruleId: rule.id,
      aggregatedSummary,
      finalRecommendation,
      conclusions,
      conflicts
    };
  }

  private buildPrompt(rule: ClinicalRule, templateSummary?: string) {
    const base = `
你是一名血常规/POCT 临床辅助 AI。请针对以下组合给出病理解读、可能病症和建议：
- 组合描述：${rule.description || "未提供"}
- 已有解读：${rule.explanation || "暂无"}
- 模板参考：${templateSummary || "无"}
输出 2~3 句话，说明可能病因与建议，不要返回 JSON。`;
    return base;
  }

  private async queryOpenRouter(rule: ClinicalRule, template?: string) {
    if (!this.openRouterKey) return null;
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.openRouterKey}`
      },
      body: JSON.stringify({
        model: "google/gemini-3.0-flash-preview",
        reasoning: { enabled: false },
        messages: [
          {
            role: "system",
            content:
              "You are a hematology expert that validates POCT rule interpretations. Respond concisely in Chinese."
          },
          {
            role: "user",
            content: this.buildPrompt(rule, template)
          }
        ]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter insight error ${response.status}: ${text}`);
    }
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      return content
        .map((chunk: any) => chunk?.text ?? chunk?.content ?? "")
        .join("\n")
        .trim();
    }
    return null;
  }

  private async queryDeepseek(rule: ClinicalRule, template?: string) {
    if (!this.deepseekKey) return null;
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.deepseekKey}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "你是血液科主治医生，负责核对组合解读并提示潜在风险。回答用简明中文。"
          },
          {
            role: "user",
            content: this.buildPrompt(rule, template)
          }
        ]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Deepseek insight error ${response.status}: ${text}`);
    }
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content === "string") return content.trim();
    return null;
  }

  private buildHeuristicConclusion(rule: ClinicalRule) {
    const normalizedText = `${rule.description ?? ""} ${rule.explanation ?? ""}`.toLowerCase();
    const template = CLINICAL_COMBO_LIBRARY.find((item) => {
      if (item.status === "discarded") return false;
      return item.indicators.every((pattern) =>
        pattern.aliases.some((alias) => normalizedText.includes(alias.toLowerCase()))
      );
    });

    const baseText =
      template?.summary ||
      rule.explanation ||
      rule.description ||
      "尚无解读，请补充对应资料。";
    const recommendation = template
      ? `建议依据「${template.title}」模板提示：${template.summary}`
      : "建议补充临床解释或参考 AI 建议。";
    const conclusion: CrossCheckConclusion = {
      model: "Heuristic",
      text: `知识库：${baseText}`,
      confidence: template ? 0.82 : 0.55
    };
    return {
      template: template?.summary,
      conclusion,
      recommendation,
      theme: this.classifyTheme(baseText)
    };
  }

  private classifyTheme(text: string) {
    const normalized = text.toLowerCase();
    if (/感染|infection|细菌/.test(normalized)) return "infection";
    if (/贫血|anemia/.test(normalized)) return "anemia";
    if (/过敏|allergy|嗜酸/.test(normalized)) return "allergy";
    if (/出血|thrombocytopenia|血小板/.test(normalized)) return "bleeding";
    if (/正常|无异常|stable/.test(normalized)) return "normal";
    return "unknown";
  }

  private detectConflict(
    heuristicTheme: string,
    modelTheme: string,
    modelName: string
  ) {
    const conflicts: string[] = [];
    if (heuristicTheme === "infection" && modelTheme === "normal") {
      conflicts.push(`${modelName} 判定“正常”，与感染提示不一致`);
    }
    if (heuristicTheme === "anemia" && modelTheme === "normal") {
      conflicts.push(`${modelName} 未提示贫血，结果需人工确认`);
    }
    if (heuristicTheme === "bleeding" && modelTheme !== "bleeding") {
      conflicts.push(`${modelName} 未强调出血风险`);
    }
    return conflicts;
  }

  private estimateConfidence(text: string) {
    const normalized = text.toLowerCase();
    if (/建议|需|should|recommended/.test(normalized)) return 0.78;
    if (/可能|suspect/.test(normalized)) return 0.65;
    return 0.5;
  }

  private composeAggregate(conclusions: CrossCheckConclusion[]) {
    return conclusions
      .map((item) => `${item.model}: ${item.text}`)
      .join("\n");
  }

  private resolveEnvKey(keys: string[]) {
    for (const key of keys) {
      if (typeof import.meta !== "undefined") {
        const metaEnv = (import.meta as any).env || {};
        if (metaEnv[key]) return metaEnv[key];
      }
      if (typeof process !== "undefined" && process.env[key]) {
        return process.env[key];
      }
    }
    return undefined;
  }
}
