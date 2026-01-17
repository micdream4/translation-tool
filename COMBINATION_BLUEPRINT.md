# POCT 异常组合策略蓝图

本方案基于当前 `白细胞正常.xlsx` 表格的结构化规则与翻译链路，提出用于扩展 **异常指标组合**（以 AWBC、SRBC、血常规指标为主）的实施策略。目标是在保持翻译、组合校验、AI 解读彼此解耦的前提下，为医生提供可审核的知识库与自动解读能力。

---

## 1. 基础假设与数据来源
1. **全部规则仍以 Excel 行为单位**，每行包含「组合触发条件」「结论/解读」「提示级别」等字段。
2. **RuleEngine** 会把每行解析成 `ClinicalRule`，MultiAIJudge 负责生成 AI 解读。
3. 新增异常指标（AWBC、SRBC 等）与既有指标并列，仍遵循“条件 → 结论”的模式；**暂不依赖 Thalassemia（地中海贫血）等需额外光路的指标**。
4. 医疗团队会持续提供自研组合或删除不符合临床意义的组合，系统需记录 `status: active/discarded`。

---

## 2. 指标定义与语义（血常规优先）
| 指标 | 临床含义 | 典型异常提示 | 候选组合用途 |
|------|----------|--------------|--------------|
| **AWBC** (Abnormal WBC) | 机器学习筛出的异常白细胞群 | 高值 → 异常粒细胞/白血病前驱；低值 → 白细胞碎裂/标本问题 | 与 WBC/NEU/LYM 联动，提示炎症 vs. 骨髓抑制 |
| **SRBC** (Sickle RBC) | 镰刀型红细胞检测，当前算法可识别 | 阳性 → 镰刀型细胞贫血风险 | 结合 HGB/HCT/PLT，提示溶血或缺氧诱发 |
| **CBC 基础指标** | WBC、NEU、LYM、RBC、HGB、HCT、PLT、MCV 等 | 升高/降低状态 | 构建传统血常规规则库 |

> **暂缓 Thal 相关组合**：受光路与算法限制，当前暂不依赖 Mentzer Index、HbA2 等指标。待硬件/算法支持后再恢复地中海贫血模板。

---

## 3. 组合分类结构
> 采用“基础组合库 + 医生审核”策略。所有组合均以模板形式存于 `data/clinicalCombos.ts`（或后台数据库），前端只做展示与提示。

### 3.1 感染/炎症相关
- **AWBC + NEU 升高** → 细菌感染/急性炎症，severity=`warning`
- **AWBC 升高 + CRP 高**（若后续加入 CRP）→ 严重炎症，severity=`critical`
- **AWBC 异常 + LYM 下降** → 免疫抑制风险，severity=`warning`

### 3.2 造血抑制 / 血液肿瘤
- **AWBC 异常 + 原有 WBC 极低 + PLT 下降** → 骨髓抑制或白血病，severity=`critical`
- **AWBC 异常 + 异常细胞计数提示 + SRBC 阳性** → 需排除血液肿瘤或溶血性贫血，severity=`critical`

### 3.3 镰刀型贫血（SRBC）
- **SRBC 阳性 + HGB/HCT 显著低** → 镰刀型贫血急性发作，severity=`critical`
- **SRBC 阳性 + HGB 正常但 AWBC 异常** → 可能处于携带者/诱发期，给“监测 + 避免缺氧”建议，severity=`warning`
- **SRBC 阳性 + PLT 下降** → 溶血合并 DIC 风险，severity=`critical`

### 3.4 其他血常规组合
- **WBC 高 + LYM 低** → 急性细菌感染伴免疫抑制，severity=`warning`
- **RBC/HGB/HCT 同步低 + MCV 正常** → 中度贫血待分型，severity=`warning`
- **PLT 低 + AWBC 异常** → 骨髓抑制或血液肿瘤可能，severity=`critical`

### 3.5 暂缓的扩展
- 地中海贫血（Thal）相关组合记为“待硬件/算法升级”项，不纳入当前缺失检测。

---

## 4. 规则模板示例
可直接写入 `clinicalCombos.ts`，或迁移至 API/数据库。示例结构：

```ts
{
  id: "combo-awbc-neu-high",
  title: "AWBC 异常 + NEU 升高（急性感染）",
  summary: "AWBC 与 NEU 同步升高，多见于急性细菌感染或炎症风暴，需结合症状和 CRP。",
  severity: "warning",
  indicators: [
    { indicator: "AWBC", aliases: ["AWBC", "异常白细胞"], operator: ">" },
    { indicator: "NEU", aliases: ["NEU", "中性粒"], operator: ">" }
  ],
  keywords: ["感染", "inflammation"],
  evidence: ["POCT 感染筛查规范 2024"]
}
```

---

## 5. 流程 & 工程实现
1. **组合库维护**  
   - 短期：继续将模板写在 `data/clinicalCombos.ts` 方便前端演示。  
   - 长期：迁移至后端 API 或 Supabase 等存储，支持医生在后台 CRUD、打标签。
2. **RuleEngine 接入**  
   - 解析 Excel 行 → `ClinicalRule`。  
   - 对每条规则调用 `templateMatchesRule()`，若命中则标记为已覆盖；否则提示缺失。
3. **新增指标支持**  
   - 解析/翻译阶段重点支持 AWBC、SRBC 与既有 CBC 列。  
   - 暂不依赖 Thal/HbA2 等外源指标，避免无效提示。
4. **AI 解读**  
   - `MultiAIJudge` 使用模板 summary 作为 system context。  
   - 带上“指标名称 + 异常方向 + 现有描述”后发送至 OpenRouter/Deepseek，给出建议、风险等级。  
   - 输出结构中保留 `templateId`，便于医生回查对应模板。
5. **医生审核闭环**  
   - UI 增加“Mark as Accepted/Discarded”按钮（本地存储或云端），标记的组合不再提示。  
   - 导出 `missingCombinations` 时附带 `templateId`、`evidence`，便于线下讨论。

---

## 6. 建议的迭代顺序
| 步骤 | 内容 | 说明 |
|------|------|------|
| Step 1 | 在 `clinicalCombos.ts` 中补齐 AWBC/SRBC + 常规 CBC 模板 | 可先录入 8~10 条高价值组合 |
| Step 2 | RuleEngine 增强：支持新指标别名、severity 识别 | 目前已具备基础骨架，只需补充关键字 |
| Step 3 | UI 更新：在缺失组合列表中标识 `templateId` & severity | 便于医生筛选重点 |
| Step 4 | AI 解读结合模板摘要 | MultiAIJudge 已支持模板提示，可逐步放量 |
| Step 5 | 医生反馈回收机制 | 允许将模板标记为 discarded，并记录备注 |

---

以上方案提供了从数据解析 → 组合识别 → AI 解读的完整链路，并考虑到未来新增异常指标与临床审核需求。后续可按步骤逐步落地，确保每条组合都能被医生验证并持续优化。***


## 7. 讨论方向：
AWBC / SRBC 讨论总结（给你和医生用）

背景

当前表格：白细胞正常.xlsx（318 行，45 列），每个指标固定 3 列：升高/降低、临床提示、判断依据。
目标：新增异常指标并更新组合解读，但不凭空造规则。
你已确认的规则

AWBC：只允许 ↑（异常升高），来源于 WBC 分群中“无法归类的异常白细胞”，有数值。
SRBC：在该“白细胞正常.xlsx”中不加入（因为这是白细胞表），SRBC 只用于红细胞相关文件。
结论输出：继续沿用高/中/低概率体系。
覆盖策略：采用融合覆盖（AWBC出现时把异常提示置顶，替换“无异常”类结论，但保留原组合逻辑）。
待医生确认的关键点

AWBC 应出现在哪些组合里
不能推断全部组合都加 AWBC↑，需医生确认哪些组合“合理出现 AWBC↑”
我可以先给你一份“候选组合清单”筛选：
基于 NST# / NSG# / NSH# / ALY# 等异常指标为候选
可分两档：
严格：只要出现“↑”
宽松：出现“↑/↓/异常相关描述”
AWBC 默认的临床提示/判断依据（可先统一一版）
临床提示：AWBC↑提示异常白细胞群或异常细胞成分增多，需结合血涂片/临床判断感染、炎症或血液系统异常
判断依据：AWBC 为机器识别的异常白细胞计数，升高提示异常细胞聚集或识别困难的白细胞成分增加，建议复查或人工镜检
我建议的执行方式

先生成一份更新版 Excel（不影响原表）
输出：白细胞正常_AWBC_模板.xlsx + AWBC_候选组合清单.xlsx
用于医生讨论，确定哪些组合勾上 AWBC↑
医生确认后，再自动批量写入 AWBC，并重写“总结/解读/可能疾病”