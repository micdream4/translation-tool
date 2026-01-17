# AWBC/SRBC 处理上下文备份

本文件用于在新窗口/新会话中快速恢复本次 AWBC/SRBC 更新任务的关键信息。

## 关键目标
- 在多 sheet Excel 中补齐 AWBC/SRBC 的临床提示与判断依据。
- 在“总结1/总结2/解读/可能疾病1-3”中融合 AWBC/SRBC 风险提示。
- 保持既有指标列与组合逻辑不变，仅改动解释层字段。
- 支持带文献引用的表述格式，并保留旧版本模板。

## 输入/输出文件
- 输入文件（含 4 个 sheet）:
  - `BA212新8分类解读-AI版-二次审核-增加AWBC SRBC-20260106.xlsx`
  - Sheet:
    - `白细胞正常-AWBC`
    - `白细胞增高-AWBC`
    - `白细胞降低-AWBC`
    - `红细胞和血红蛋白-SRBC`
- 输出文件:
  - `BA212新8分类解读-AI版-二次审核-增加AWBC SRBC-20260106_补充提示.xlsx`

## 脚本位置与用法
- 脚本: `scripts/update_awbc_srbc.py`
- 用法:
```bash
python scripts/update_awbc_srbc.py \
  --input "BA212新8分类解读-AI版-二次审核-增加AWBC SRBC-20260106.xlsx" \
  --output "BA212新8分类解读-AI版-二次审核-增加AWBC SRBC-20260106_补充提示.xlsx" \
  --profile v2
```

## 模板版本
- `v1`: 旧版模板（不带引用）
- `v2`: 新版模板（带引用，按指定格式）
- 切换由 `--profile` 控制，默认 `v2`。

## 变更范围（审计结论）
仅修改以下列组（合并表头级）:
- `AWBC#` 或 `SRBC#` 组
- `总结1` / `总结2` / `解读`
- `可能疾病1` / `可能疾病2` / `可能疾病3`
其它指标列保持不变，保证设备规则匹配不受影响。

## 引用清单（v2）
AWBC:
- [1] Palmer L, et al. ICSH recommendations... Int J Lab Hematol. 2015.
- [2] ISLH. Consensus rules for blood smear review...
- [3] CLSI. H20: Reference Leukocyte Differential Count...
- [4] Tripathi AK, et al. Laboratory Evaluation of Acute Leukemia. StatPearls. 2025.
- [5] Lynch EC. Peripheral Blood Smear. Clinical Methods. 1990.
- [6] Al-Gwaiz LA, et al. Toxic granulation predicting bacterial infections. 2007.

SRBC:
- [7] NHLBI (NIH). Sickle Cell Disease – Diagnosis. 2024.
- [8] NHLBI. Evidence-Based Management of Sickle Cell Disease.
- [9] American Society of Hematology. Hemoglobin Electrophoresis in SCD.
- [10] Palmer L, et al. ICSH morphology recommendations. 2015.
- [11] National Academies. Screening protocols for hemoglobin separation methods.

## 当前模板策略（v2）
- 临床提示格式:
  - “检测到…多见于…[n]…请医生查看细胞图片，建议进一步询问…或做…[n+1] 排查。”
- 解读字段: 置顶插入 AWBC/SRBC 解释。
- SRBC 疾病优先级: 强制进入“可能疾病1”。
- AWBC 疾病优先级: 优先填空，否则追加到疾病3分析。

## 后续可调整项
- 引用清单的具体文献信息（标题/期刊/年份/DOI）。
- AWBC/SRBC 提示语/依据模板。
- 是否在“无明显异常”场景进行替换或保留。
