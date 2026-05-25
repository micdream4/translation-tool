# 项目进度

## v0.0.84

- 修复 String Resource Translator 在 Auto 模式下葡语/俄语单选失败的问题：普通翻译 Auto 现在会把 `openRouterModels` 传给 `TranslationHub`，本地 direct 路径不再只打默认第一个 OpenRouter 模型。
- 保持 string 资源原有业务规则：仅检测并翻译中文内容，英文、代码、标签、占位符和型号仍按原逻辑保护或原样保留。
- 回归测试覆盖 Auto 模式模型链传递，以及 OpenRouter 第一个模型 403 时继续 fallback 到后续模型。
- 建立本地 issue 包 `local-data/issues/2026-05-25-string-resource-portuguese-russian-not-translating/`，记录真实请求验证和修复归因。
- 版本号更新为 `v0.0.84`。

## v0.0.83

- PDF 导出从 jsPDF 切换到 `pdf-lib + @pdf-lib/fontkit`，并嵌入 OFL 授权的 `NotoSansHans-Regular`，中文、繁中和俄文等非拉丁目标语言不再默认渲染成图片。
- 保留 v0.0.82 的原页背景保真策略，同时译文层改为优先写入可选择文本，减少“看得到但不能复制”的问题。
- 增加回归验证：生成包含中文和俄文的 PDF 后用 `pdftotext` 抽取，确保文本层可复制。
- 移除 `jspdf` 依赖，新增 `pdf-lib`、`@pdf-lib/fontkit`、`@embedpdf/fonts-sc`。
- 版本号更新为 `v0.0.83`。

## v0.0.82

- PDF 导出改为保守版式保真策略：解析时保存每页原始渲染背景，导出时先铺原页背景，再在原文本区域覆盖背景色并叠加译文，减少复杂 PDF 丢封面底色、logo、章节视觉层级和插图的问题。
- 修复中文 PDF 译文横向溢出：Canvas 文本换行支持无空格的中文长句按字符拆行。
- 修复英文源文翻中文的质量检查误报：目标语言为中文或繁体中文时，不再把中文译文统计为 `Chinese residue`。
- 空白漏翻检查不再假设源文必须包含中文，英文源文翻中文或其他语言时也能检查空白目标段。
- 建立本地 issue 包 `local-data/issues/2026-05-24-pdf-chinese-layout-and-quality-residue/`，记录真实 PDF 排版和质量检查边界问题。
- 版本号更新为 `v0.0.82`。

## v0.0.81

- 移除应用层邮箱白名单：后端不再读取 `ALLOWED_USER_EMAILS` / `ALLOWED_EMAILS`，只要求 Cloudflare Access 提供 `CF-Access-Authenticated-User-Email`。
- `wrangler.toml` 删除 `ALLOWED_USER_EMAILS`，以后新增访问邮箱只需要在 Cloudflare Zero Trust Access Policy 中维护，不需要改代码或重新部署。
- `/api/me` 返回 `accessControlledBy: "cloudflare-zero-trust"`，避免前端显示 blocked 的原因被应用白名单误导。
- README、Cloudflare 部署文档、架构计划和交接文档同步更新。
- 版本号更新为 `v0.0.81`。

## v0.0.80

- 收口 DOCX/PDF 问题来源：`buildDocxIssueDetails` 和 `buildPdfIssueDetails` 改为从 Quality Core 的 `runQualityChecksOnUnits` 结果映射，避免 Quality Check、审计和 Retry Missing Segments 使用不同判断。
- Smart Fill、Excel retry 和单元格候选判断统一复用 `shouldTranslateCellValue`，按钮英文残留、锁定字段、纯代码/符号和目标语言判断不再分散实现。
- DOCX/PDF 本地占位符修复后的剩余重译目标改为复用重新生成的 issue details，避免修复后过滤条件与 Quality Core 再次分叉。
- 回归测试覆盖已翻译西语按钮残留、密码字面值误判、共用 Smart Fill helper 和 DOCX/PDF issue details 使用 Quality Core。
- 版本号更新为 `v0.0.80`。

## v0.0.79

- 修复西语已翻译 DOCX 的 UI label 误判：`【Nueva cuenta】` 已翻译时，旁边保留的 `"ozelle"` 密码字面值不再被当作英文 UI label 残留。
- UI label 残留检测收紧为明确英文 UI 词表命中；`【New Account】`、`«Save»` 仍会被抓，未知字面值/密码/品牌不触发 non-target。
- 回归测试补充 `New Account -> Nueva cuenta` + `"ozelle"` 保留场景。
- 版本号更新为 `v0.0.79`。

## v0.0.78

- 修复“上传已翻译 DOCX 后 Smart Fill / Quality Check 漏检按钮英文残留”的问题：没有英文原文对照时，也会直接扫描译文里 `「」`、`【】`、`«»` 等包裹的英文 UI label。
- `«Save»`、`「Home」` 这类自然语言按钮名在非英语目标中会进入 Smart Fill 候选、DOCX/PDF Quality Check 和 Retry Missing Segments；`«QC»`、`[USB2.0]` 等代码型标签继续跳过。
- 该判断沉淀为共用 helper，并补充回归测试覆盖西语已翻译文档场景。
- 版本号更新为 `v0.0.78`。

## v0.0.77

- UI 标签策略调整：`「Save」`、`【Home】` 这类自然语言按钮/菜单/页面名默认翻译成目标语言，继续保留原有 `「」`、`【】` 等外层符号，方便替换截图时核对。
- 翻译前 token 保护收窄为代码型 UI 标签、缩写、型号、ID、URL/单位等不可翻译锚点；`CBC`、`QC`、`USB2.0` 等仍会保护，普通按钮名不再保护。
- Quality Core 不再把自然语言 UI label 当低优先级噪声剥离；如果非英语目标译文仍保留源文按钮名，会进入普通 `Non-target language` 高风险问题。
- 本地 DOCX 脚本和前端 OpenRouter prompt 同步更新，避免真实环境与命令行链路策略不一致。
- 回归测试补充 UI label 翻译策略，防止后续再次把按钮名整体保护成英文残留。
- 版本号更新为 `v0.0.77`。

## v0.0.76

- 修复 DOCX 多 run 回写导致的断词：当原文 run 在单词内部切开时，译文不再按原 run 长度比例切分，避免西语 `mult i funciona l`、`D e claración`、`Pr efacio` 这类问题。
- 翻译前保护按钮、图标、页面名等 UI 标签，默认保留英文；如后续截图/UI 本身本地化，再按实际界面语言调整。
- 后处理新增章节编号、标准号和版本号压缩，`1. 1`、`7. 2. 10`、`USB 2. 0` 会恢复为 `1.1`、`7.2.10`、`USB 2.0`，减少 DOCX 目录更新后的割裂。
- Quality Report 降噪：单位/指标代码/URL 不再作为非目标语言或 high spacing 噪声；低优先级 UI 标签提示从真实 residual 统计中拆出。
- 针对西语 DOCX 目录/run split 和俄语目录编号空格建立本地 issue 包，并补充回归测试覆盖 DOCX run split、UI label 保护、编号空格和俄语/西语质量边界。
- 版本号更新为 `v0.0.76`。

## v0.0.75

- 修复短保护词边界：如 `EN`、`CE` 这类标准/认证缩写只在独立 token 时保护，避免误切 `Enter`、`access`、`process` 后污染俄语译文。
- DOCX/PDF 质量检查与 retry 使用同一套 UI 标签剥离逻辑；截图按钮/图标名保留会降为低风险提示，普通说明书英文残留继续作为高风险项。
- DOCX retry 改为使用原始 segment 重译，避免把已污染译文继续送回模型。
- Quality Report Findings 增加 All/High/Medium/Low 筛选，方便先处理高风险项。
- Finding 的人工修正按钮改为 `Save & Apply`：DOCX/PDF 修正会写回当前文档对象，并刷新质量检查；导出文件会包含该修正。
- Live Data Preview 对 DOCX/PDF 改用 segment 数据，Jump 后能看到对应原文和译文上下文。
- 版本号更新为 `v0.0.75`。

## v0.0.74

- 清理 Translator 左侧 Quality Check 操作区：移除旧的 DOCX `Export Issue Report`，统一使用 Quality Report 面板的 `Export Report`、`Debug Package` 和 `Issue Draft`。
- `Apply Cleanup` 和 `Retry Placeholder Cells` 保留为 Excel 专属修复入口，仅在 Excel 文件场景显示，避免 DOCX/PDF 上传后看到灰色按钮误以为功能失效。
- 移除旧的 `Advanced Checks` 左栏入口和底部 `Advanced Signals` 展示；组合校验/多 AI 评审后续统一走独立的 Multi-AI Review Lab。
- 操作说明同步更新：明确 cleanup 和 placeholder retry 是 Excel 文件功能。
- 版本号更新为 `v0.0.74`。

## v0.0.73

- 针对 DOCX 英文转俄语 `Retry Missing Segments` 后仍反复提示的问题建立本地 issue 包：`local-data/issues/2026-05-17-docx-russian-residual-after-retry/`。
- Quality Check 区分三类残留：真实英文/模型残片继续作为重译目标；`Wi-Fi`、单位、血球代码、标准号、科学名、公司/型号等技术保护项不再误判；按钮/图标 UI 标签保留为低优先级提示，提醒用户核对截图或界面替换，但不进入自动 Retry 目标。
- 修复 ID mismatch 误判：`Model: EHVT-75` 这类含型号的普通句子不再按整段锁定字段处理，只有纯 ID/UUID/型号字段才触发锁定比较。
- 俄语后处理新增常见模型残片修复：`повыceет`、`сниceет`、`проceсс`、`спиlisку`、`устройстce` 等会自动归一为俄语；同时修复 `Co. , Ltd. .`、`A 4`、`ozellemed. com`、`[. . .]` 等格式问题。
- 回归测试覆盖技术代码误判、UI 标签低优先级提示、空白段不报格式、俄语残片后处理和 ID 句子误判。
- 版本号更新为 `v0.0.73`。

## v0.0.72

- 修复 DOCX 译文回写会覆盖 `segment.original` 的问题：Word 文本节点仍会写入译文，但语义段原文保持不可变，Quality Report finding 的 Source 能继续显示真实英文原文。
- Quality Check 的非目标语言检测改为先剥离 Protected Terms；品牌名、公司名、型号等受保护词不会再单独触发非目标语言残留。
- Translation Memory 增加 `Use Translation Memory` 开关；关闭后本次翻译既不复用本地 TM，也不写入新 TM，便于干净复测。
- 简化本地问题反馈流程：用户只需放原文、译文、Debug Package/Quality Report 和截图，Codex 负责后续归类到本地 issue 包。
- 版本号更新为 `v0.0.72`。

## v0.0.71

- 修复 Quality Report finding 的 Source / Target 展示策略：所有 finding 和导出报告优先从 `qualityRows.sourceRows/targetRows` 读取原文与译文，避免 DOCX/PDF 报告把译文误显示为原文。
- 针对 DOCX 英文译俄语的真实问题建立本地 issue 包：`local-data/issues/2026-05-16-docx-russian-quality-source-target-mismatch/`，包含 Debug Package、Quality Report 和复核说明。
- 回归测试覆盖“issue.original 不可靠时仍使用 qualityRows 原文/译文”的情况，防止后续质量报告再次显示同源同译。
- 版本号更新为 `v0.0.71`。

## v0.0.70

- 将 `local-data/README.md` 改成中文目录规则，明确 `inbox`、`done`、`failed`、`issues`、`debug-packages`、`regression-jsonl`、`issue-assets`、`screenshots` 分别放什么。
- `scripts/prepareLocalIssueWorkspace.mjs` 的 README 模板同步改为中文规则，后续新建本地 workspace 时不会再生成模糊英文说明。
- 回归测试补充本地 README 模板断言，确保问题捕获目录规则不会丢失。
- 版本号更新为 `v0.0.70`。

## v0.0.69

- 按“先打基础，再做多 Agent”的路线新增 `docs/local-issue-capture-workflow.md`，明确 Mac 本地发现问题时如何保存 Debug Package、Regression JSONL、Asset JSON、截图和本地 issue 包。
- 新增 `scripts/prepareLocalIssueWorkspace.mjs` 和 `npm run issue:prepare`，一键准备 ignored 的 `local-data/inbox`、`local-data/issues`、`local-data/debug-packages`、`local-data/regression-jsonl` 等目录。
- 更新质量闭环和跨电脑 Issue 文档：公司电脑仍走 GitHub Issue，Mac 本地小问题可先保存到本地 issue workspace，后续再沉淀为测试、规则、术语或 TM。
- 回归测试新增本地问题捕获工作流断言，确保脚本、文档和 `local-data/` 忽略策略保持一致。
- 版本号更新为 `v0.0.69`。

## v0.0.68

- 真实文档回归库第一版落地：新增 `fixtures/real-document-regression.json`，把本地 Excel / DOCX / PDF 样本、目标语言和验证预期从脚本中抽成可版本化 manifest。
- `npm run test:real-docs` 改为 manifest 驱动，输出 `caseId`、检查状态、真实文件质量统计、DOCX 已知残留命中和 PDF legacy image-only 基线。
- 真实文档仍只保存在 `local-data/`，仓库只记录相对路径和检查规则，避免把敏感文件提交到 git。
- 普通回归测试新增 manifest 结构断言，确保真实回归样本覆盖 Excel / DOCX / PDF，且 `local-data/` 继续被忽略。
- 版本号更新为 `v0.0.68`。

## v0.0.67

- 问题样本资产化继续落地：新增 `utils/issueAssets.ts`，可把本地 issue cases 转成 Translation Memory 句对、术语候选和 QA rule candidates。
- Quality Loop 面板新增 `Promote TM`，可将已保存的人工修正样本批量写入本地 Translation Memory。
- Quality Loop 面板新增 `Asset JSON`，导出 `poct.translation_issue_assets.v1`，包含 TM、术语候选、QA 规则候选和统计信息。
- 回归测试覆盖 issue asset package、TM pair、术语候选和 QA rule candidate 生成，确保问题不会只停留在截图或 JSONL。
- 版本号更新为 `v0.0.67`。

## v0.0.66

- PDF 文本层专项修复：新增 `utils/pdfTextLayer.ts`，把 PDF 可复制文本层规范化逻辑从 `pdf.ts` 拆出，便于独立测试。
- PDF 直出对法语等 Latin 目标语言不再因 `’`、`œ`、窄空格、长横线、`µ` 等字符整段回退 PNG；会先规范化为 Helvetica/Latin-1 可写文本层，再必要时回退图片文本。
- 新增 `getPdfTextLayerStats`，下载译文 PDF 前日志会显示“可复制文本层段数 / 总段数 / 图片回退段数”，方便判断导出的 PDF 是否适合复制核对。
- 回归测试覆盖 `normalizePdfTextLayerText` 与 `canDrawSelectablePdfText`，确认法语文本可进入文本层，俄语等非 Latin-1 文本仍回退图片文本。
- 版本号更新为 `v0.0.66`。

## v0.0.65

- 目标语言 profile 继续做实：`utils/languageProfiles.ts` 新增 French 高置信英文残留词/短语规则，`Quickly squeeze`、`The blue button is lifted` 等 PDF 操作标签可被法语目标检测拦截。
- Russian profile 扩展真实 DOCX 中暴露的残留词：`ref`、`year`、`reference`、`service`、`sample`、`result(s)` 等；俄语轻量后处理新增 `1-year -> 1 год` 和常见 UI/说明书残留替换。
- `isLikelyTargetLanguage` 已接入 profile 级英文残留规则，Latin 语种不再只依赖通用 language score，后续 Spanish/Portuguese/German/Turkish 可按同一结构扩展。
- `fixtures/translation-issue-regression.jsonl` 从 3 条扩展到 5 条，新增法语 PDF 英文标签残留和俄语 `1-year` 残留回归样本。
- 回归测试新增 Russian/French profile 可执行规则覆盖，`npm test` 与 `npm run test:issue-regression` 通过。
- 版本号更新为 `v0.0.65`。

## v0.0.64

- 继续统一 Quality Check Core：`runQualityChecks` / `runQualityChecksOnUnits` 新增 `targetLang` 选项，Excel、DOCX、PDF 可在同一份 `QualityReport` 中记录非目标语言残留。
- `QualityReport` 新增 `nonTargetLanguage` issue、`nonTargetCells` 和 `nonTargetRows` 统计，Quality Report 面板的 Residual 卡片不再只依赖外层 issue summary。
- 新增 `quality/report.ts` 和 `quality/retryTargets.ts` 命名空间兼容层，新的质量报告与补译目标代码可以优先从 `quality/` 入口引入，旧 `utils/` 入口继续保留兼容。
- `useQualityWorkflow` 的 Excel/DOCX/PDF Quality Check 均传入目标语言，俄语这类混入英文的残留可被统一质量核心识别并进入 finding/debug package/issue case 链路。
- 回归测试补充 `targetLang` 驱动的非目标语言检查，`npm run test:quality-gate` 通过；真实文档 smoke 继续显示 DOCX 俄语残留和 PDF 译后文本层为空，后续进入第 2/3 项专项修复。
- 版本号更新为 `v0.0.64`。

## v0.0.63

- 自我迭代闭环继续落地：新增 `utils/regressionAssets.ts`，可把本地 issue cases 或 Debug Package 转成 `poct.translation_regression_case.v1` 回归样本。
- 新增 `fixtures/translation-issue-regression.jsonl` 和 `npm run test:issue-regression`，先覆盖俄语英文残留、占位符泄漏、数字单位格式三类问题。
- 新增 `scripts/debugPackageToRegression.mjs`，公司电脑导出的 Debug Package JSON 可转换为回归测试 JSONL，追加到 fixture 后进入自动测试。
- Quality Report 的 Quality Loop 增加 `Regression JSONL` 导出按钮，人工修正样本可直接沉淀为回归测试资产。
- `quality/checks.ts` 成为统一 Quality Check Core，`utils/quality.ts` 改为兼容导出，后续 Excel/DOCX/PDF 检查继续向 `quality/` 收敛。
- `utils/languageProfiles.ts` 扩展为多目标语言 profile 结构，已包含 Russian、French、Spanish、Portuguese、German、Italian、Turkish、Traditional Chinese (Taiwan) 的第一版规则骨架。
- 新增 `.github/workflows/quality-gate.yml` 和 `npm run test:quality-gate`，把 typecheck、普通回归、issue regression、build、真实文档 smoke 串成质量闸门。
- 清理无用临时目录和生成物，`.gitignore` 忽略 `local-data/`、`output/`、`tmp/`、`.tmp-real-*/`、`docs/debug/`；根目录旧计划文档迁入 `docs/plans/`。
- 版本号更新为 `v0.0.63`。

## v0.0.62

- QualityUnit/QualityIssue 增加 `locationLabel`，DOCX/PDF 的 Quality Report finding、导出报告和异常摘要现在优先显示文档段落位置，而不是退回 Excel 风格行列。
- 新增 `utils/languageProfiles.ts` 俄语 profile 第一版，沉淀 `Home / Orders / Reports / List / feces / reference / Building / Street` 等英文残留词，俄语残留检测改为复用 profile。
- Quality Report 面板新增 `Issue Draft`，可导出 GitHub Issue Markdown 草稿；`Debug Package` 仍导出 JSON 附件，形成“草稿 + 调试包”的远程反馈入口。
- 真实文档 smoke 的 PDF 样本查找改为兼容 `检测教程-202英文.pdf` 和旧的 `(1)` 文件名，避免真实 PDF 基线被误跳过。
- 回归测试补充 Issue Draft、俄语 profile、QualityUnit locationLabel 和 PDF 样本发现逻辑覆盖。
- 版本号更新为 `v0.0.62`。

## v0.0.61

- 检查远端 GitHub Issue 模板：`.github/ISSUE_TEMPLATE/translation-bug.yml` 已在 `origin/main`。
- 模板新增 `Debug Package` 字段，和页面 Quality Report 的本地调试包导出闭环对齐。
- 由于仓库当前只有 GitHub 默认 labels，模板标签改为现有 `bug`，避免引用尚未创建的 `translation-bug` / `needs-triage` 自定义标签。
- 回归测试新增 Issue 模板断言，确保模板保留 `Debug Package` 字段并只引用可用 label。
- 版本号更新为 `v0.0.61`。

## v0.0.60

- 新增 `utils/debugPackage.ts`，提供 `poct.translation_debug_package.v1` 调试包构建器。
- Quality Report 面板新增 `Debug Package` 按钮，可一键导出 JSON，包含版本、文件类型、目标语言、模型、格式快照、Quality Report、异常摘要、finding、issue cases 和问题行样本。
- 调试包只本地下载，不自动上传外部服务；JSON 内置隐私提示，方便公司电脑发现问题后脱敏并贴到 GitHub Issue。
- 回归测试新增 debug package schema、元数据、issue cases 和问题行样本校验。
- 版本号更新为 `v0.0.60`。

## v0.0.59

- 新增 `utils/retryTargets.ts`，把 Quality Issue 到 Retry target 的生成逻辑抽成纯函数层。
- Excel 的可补译行/单元格统计和 `Retry Missing Cells` 实际发送给模型的 sanitized rows 已改为复用同一套 helper，避免 UI 显示、Quality Check 和补译目标各自判断。
- DOCX/PDF 的 retry segment 选择改为复用 `buildTextSegmentRetryPlan`，统一“优先高优先级问题，必要时回退低优先级短文本”的策略。
- 回归测试新增 retry target helper 覆盖，确保锁定字段被排除、占位符保护会进入 sanitized row、高优先级文档段优先重译。
- 版本号更新为 `v0.0.59`。

## v0.0.58

- 继续拆完 Quality workflow：`runQualityCheck` 的 Excel/DOCX/PDF 执行入口已从 `App.tsx` 迁入 `hooks/useQualityWorkflow.ts`。
- `App.tsx` 现在只负责传入文档上下文 getter、issue builder、状态 setter 和质量输入 adapter，Quality Check 的报告写入、日志、Sample Review 重置和 Excel 进度同步都由 hook 统一处理。
- 回归测试更新为检查 `runQualityCheck`、`runQualityChecksOnUnits` 和 Excel row-based 检查入口都在 `useQualityWorkflow` 内，避免后续把质量入口又写回主组件。
- 版本号更新为 `v0.0.58`。

## v0.0.57

- 补完整 QualityReportPanel 拆分后的状态层：新增 `hooks/useQualityWorkflow.ts`，集中管理 Quality Report 状态、finding 派生、本地 issue case 计数、导出/清空、人工修正保存、Sample Review 和 AI Sample Review。
- `App.tsx` 继续减薄：质量报告 UI 已在 `components/QualityReportPanel.tsx`，质量报告状态与动作已迁入 hook，主组件保留 `runQualityCheck` 的 Excel/DOCX/PDF 执行入口和数据接线。
- 回归测试更新为检查 `useQualityWorkflow` 承接 `saveTranslationIssueCase`、`rememberTranslationPairs`、`buildQualityFindings`、`buildQualityReportText` 和 `SampleReviewAuditService`。
- 版本号更新为 `v0.0.57`。

## v0.0.56

- 继续拆分 `App.tsx`：新增 `hooks/useAuth.ts`，把 `/api/me` 身份探测、登录/阻止/匿名状态归一化从主组件移入独立 hook。
- Header 的 `authStatus` / `userEmail` 接口保持不变，Cloudflare Access 与 Pages Functions 逻辑不变。
- 回归测试新增认证拆分断言，确保 App 只调用 `useAuth()`，认证请求集中在 hook 内。
- 版本号更新为 `v0.0.56`。

## v0.0.55

- 继续拆分 `App.tsx`：新增 `components/QualityReportPanel.tsx`，把 Quality Report 展示、finding 列表、Quality Loop、抽样复核 UI 从主组件抽出。
- `App.tsx` 现在只保留 Quality Report 的状态、动作和数据接线，面板组件通过 props 接收导出、保存修正、跳转预览、AI Sample Review 等回调。
- 回归测试更新为同时检查 App 接线和 QualityReportPanel UI，确保 `Save Correction`、`Export Cases`、`Quality Loop` 仍然存在。
- 版本号更新为 `v0.0.55`。

## v0.0.54

- DOCX/PDF 的 `Run Quality Check` 执行路径改为直接使用 `segmentsToQualityUnits -> runQualityChecksOnUnits`，不再先转成临时 rows 后再检查。
- `buildDocumentQualityRows` 仍保留给 Quality Report 导出和 finding 展示使用，避免 UI 行为变化；检查核心已先迁到统一 `QualityUnit`。
- 回归测试补充断言，确保 App 已接入 `runQualityChecksOnUnits` 和 `segmentsToQualityUnits`。
- 版本号更新为 `v0.0.54`。

## v0.0.53

- 继续推进 Quality Check Core adapter：新增 `segmentsToQualityRows` / `segmentsToQualityUnits`，将 DOCX/PDF 文本段转换为统一质量检查 rows/units。
- `App.tsx` 中 DOCX/PDF Quality Report 使用的 `{ content }` 临时映射已迁入 `quality/adapters.ts`，减少主组件对文档段落结构的直接拼装。
- 回归测试扩展 segment adapter，覆盖 DOCX/PDF 类文本段到 `QualityRows` / `QualityUnit` 的转换。
- 版本号更新为 `v0.0.53`。

## v0.0.52

- 继续推进 Quality Check Core 抽离：新增 `quality/types.ts`，定义统一的 `QualityUnit`、`QualityCheckInput`、`QualityIssue`、`QualityReport` 和文档类型。
- 新增 `quality/adapters.ts`，提供 `rowsToQualityUnits` / `qualityRowsToUnits`，为 Excel、DOCX、PDF 后续统一质量检查入口打基础。
- `utils/quality.ts` 保持原有 `runQualityChecks(originalRows, translatedRows)` API 不变，但内部已迁移为 `rowsToQualityUnits -> runQualityChecksOnUnits`，降低 App 侧改动风险。
- 回归测试新增 unified QualityUnit 路径与旧 row-based 路径结果一致性校验。
- 版本号更新为 `v0.0.52`。

## v0.0.51

- 继续拆分 `App.tsx`：新增 `utils/qualityReport.ts`，把 Quality Report finding 构建、导出文本生成、finding 到 issue case 类型映射从主组件抽成纯逻辑模块。
- `App.tsx` 质量报告相关代码减少约 150 行，后续拆 `QualityReportPanel` 时可直接复用 `buildQualityFindings`、`buildQualityReportText` 和 `mapQualityFindingToIssueType`。
- 回归测试扩展到新的质量报告模块，覆盖 finding 排序、Issue 类型映射和 Quality Report 文本导出。
- 版本号更新为 `v0.0.51`。

## v0.0.50

- 新增 GitHub Issue 表单 `.github/ISSUE_TEMPLATE/translation-bug.yml`，公司电脑发现翻译、格式、导出、补译、质量检查问题时可直接提交结构化问题和脱敏截图。
- 新增 `docs/issue-report-workflow.md`，明确“公司电脑提交 Issue，Mac/Codex 读取 Issue，修复后沉淀测试/QA/术语/TM/语言 profile”的跨电脑工作流。
- 更新 `AGENTS.md`、`docs/translation-quality-loop.md` 和 `docs/context-handoff.md`，把 GitHub Issue 作为远程问题入口纳入质量闭环。
- 版本号更新为 `v0.0.50`。

## v0.0.49

- 落地质量闭环第一阶段：新增本地问题样本库 `utils/issueCases.ts`，支持保存人工修正、统计、清空、导出 JSONL。
- Quality Report 的每条 finding 新增 `Save Correction`，可把源文、错误译文、人工修正、问题类型、位置、版本、模型写入本地 issue case，并可选择同步写入 Translation Memory。
- Quality Report 新增 `Quality Loop` 区块，显示本地问题样本数量，并支持导出/清空问题样本。
- 新增回归测试覆盖 issue case 构建、JSONL 导出和 Quality Report 保存入口。
- 版本号更新为 `v0.0.49`。

## v0.0.48

- 新增 `npm run test:real-docs` 真实文档 smoke：覆盖本地 `local-data` 中的 Excel 解析/导出/Quality Check、俄语 DOCX 残留扫描、PDF 文本抽取与首屏渲染基线。
- 真实回归结果显示：Excel 结构/导出正常但存在大量 spacing 类质量提示；俄语 DOCX 样本仍有英文残留；现有法语 PDF 译后文件可渲染但不可文本抽取。
- PDF 直出新增可选择文本层优先路径：Latin-1 可覆盖的目标语言文本（如英文/法语/西语/德语/意大利语/葡语常见字符）优先写为 jsPDF 文本；不支持的字符集继续回退为 PNG 文本块。
- 版本号更新为 `v0.0.48`。

## v0.0.47

- 将非敏感 Cloudflare Pages 配置移入 `wrangler.toml` 的 `[vars]`：`VITE_TRANSLATION_MODE=proxy`、`REQUIRE_CF_ACCESS_EMAIL=true`、邮箱白名单和 OpenRouter 模型顺序以后都能在代码里直接查看和修改。
- 计划删除 Dashboard 中同名 encrypted Secret，避免邮箱白名单被隐藏；`OPENROUTER_API_KEY` 仍保留 Secret，不写入仓库。
- 版本号更新为 `v0.0.47`。

## v0.0.46

- 抽出 Cloudflare Pages Functions 共享认证层：`/api/translate`、`/api/review-samples`、`/api/model-review` 统一使用邮箱白名单、Cloudflare Access Header、本地调试邮箱和按用户 OpenRouter Key 解析。
- 新增 `/api/me` 身份探测接口，前端 Header 会显示当前访问状态（登录邮箱、Guest、Blocked、Checking），为对外开放使用和后续额度/审计打基础。
- 明确下一阶段架构方向：语言规则应拆成“基础规则 + 目标语言 profile 覆盖”，Quality Check 应抽成 Excel/DOCX/PDF 共用核心，再由各文档 adapter 提供检查单元。
- 版本号更新为 `v0.0.46`。

## v0.0.45

- DOCX/PDF 的 `Run Quality Check` 接入主质量报告，不再只支持 Excel；DOCX/PDF 会把非目标语言残留、空译文、占位符和格式问题同步到 Quality Report。
- 强化俄语 DOCX 残留英文处理：文档翻译 prompt 明确要求补译 `List / Building / feces / service / reference` 等常见英文残留，并增加少量俄语后处理修复。
- 改善 PDF 直出回写稳定性：按字号变化拆分 PDF 文本段，并在导出时按原段落高度自适应缩小译文字号，减少长段落覆盖图片和后续文本。
- 版本号更新为 `v0.0.45`。

## v0.0.44

- PDF 补译逻辑对齐 DOCX：翻译后自动审计空译文、源语言残留、占位符残留和英文目标粘词问题。
- PDF 新增 `Retry Missing PDF Segments`，只重译审计发现的问题文本段，并优先跳过低优先级短文本。
- 版本号更新为 `v0.0.44`。

## v0.0.43

- 修复 PDF 译文已处理完成后仍被下载前检查误判为“可能未翻译”的问题：现在仅在完全没有译文时阻止导出，部分段落缺译时提示 warning 并继续导出。
- 模型下拉中的 DOCX/PDF Auto 文案改为从实际模型链路生成，当前顺序显示为 Gemini Flash → DeepSeek → Qwen → Gemini 3.1 Pro → GPT-5.3。
- 版本号更新为 `v0.0.43`。

## v0.0.42

- 按最新策略调整 DOCX/PDF Auto 文档模型顺序：Gemini Flash → DeepSeek → Qwen → Gemini 3.1 Pro → GPT-5.3。
- PDF 下载按钮改为至少有译文后才启用；PDF / Review DOCX 导出失败会写入日志，不再表现为点击后无反馈。
- 版本号更新为 `v0.0.42`。

## v0.0.41

- 修复 PDF 未完成翻译时仍可下载的问题：当 PDF 没有译文或仍有疑似未翻译文本段时，下载译文 PDF 会被阻止并提示先继续翻译。
- PDF 直出改为白底重建页面：按原坐标放回可提取图片，并将译文渲染为文本图片块贴到对应位置，避免原文背景残留和浏览器 PDF 字体不支持多语言的问题。
- PDF 的 Word 辅助导出从不稳定的绝对定位 Layout DOCX 改为 Review DOCX，按页输出译文和源图片，便于复制核对，不再生成错乱排版。
- DOCX/PDF Auto 文档模型顺序调整为 Gemini Flash → GPT-5.3 → Gemini 3.1 Pro → DeepSeek → Qwen，避免 Qwen 首位导致长时间卡住或失败。
- 版本号更新为 `v0.0.41`。

## v0.0.40

- 修复俄语 DOCX 目标语言检测：`Home / Orders / Reports / AI analysis` 等英文残留混在俄文中时不再误判为已完成，智能补译会继续处理。
- DOCX 导出新增 `word/numbering.xml` 编号样式归一化，自动编号中的中文/东亚格式（如 `一、二、三`、`%1、`、`%1．`）会转换为通用数字编号。
- PDF 翻译导出升级为坐标保留：解析时记录文本段坐标、字号和图片位置，Layout DOCX 按 PDF 页面位置回填，便于复制核对。
- PDF 新增直出译文 PDF：以原 PDF 页面渲染为背景，覆盖原文本区域并按坐标写入译文，优先保持图片与页面版式。
- 新增 `jspdf` 依赖用于浏览器端译文 PDF 生成；回归测试已覆盖 PDF 直出、Layout DOCX、DOCX 编号与俄语混合英文残留检测。
- 版本号更新为 `v0.0.40`，页面 Header、浏览器标题和 URL 参数会显示当前版本。

## v0.0.39

- 补齐 TypeScript 类型健康基线，新增 `npm run typecheck`，当前 `typecheck / test / build` 均通过。
- DOCX 覆盖范围从仅 `word/document.xml` 扩展到正文、页眉、页脚、脚注、尾注、批注，并在导入/导出时显示覆盖统计。
- 增加无网络 mock 回归测试，覆盖 `/api/translate`、`/api/review-samples`、`/api/model-review` 和代理翻译拆半重试流程。
- 修复代理翻译返回记录数不匹配时未触发拆半重试的问题，现在代理路径与直连路径使用同一套返回长度/对象校验。
- 增加 Vite 手动分包，将 React、XLSX、DOCX/JSZip、PDF 相关依赖拆成独立 chunk，主入口包从约 2.07 MB 降至约 182 kB。

## v0.0.38

- PDF 正式翻译模型选择已改为与 DOCX 一致：PDF 上传后显示高质量文档模型组，Auto 使用 Qwen → DeepSeek → Gemini 3.1 → OpenAI → Gemini Flash 的文档质量链路。
- PDF 翻译请求改为使用 `docx-manual` 文档质量 prompt/profile，和 DOCX 一样强调说明书/文档语气、占位符、单位、代码和段落边界保护。

## v0.0.37

- 修复本地 dev 环境 `APP_VERSION` 为空导致 Header 不显示版本号的问题，改为从 `package.json` 兜底读取版本。
- 版本号展示位置调整到页面左上角标题 `POCT Document Translator` 右侧，同时保留浏览器标签页标题和 URL 参数版本。

## v0.0.36

- 新增目标语言 `Traditional Chinese (Taiwan) / 繁體中文（台灣）`，适用于台湾地区繁体医学/技术表达，不只是简繁字符转换。
- Excel、DOCX、PDF 翻译 prompt 已接入台湾繁体本地化约束，要求使用自然台湾用语并保留术语、单位、代码、占位符。
- 样本审核与 Multi-AI Review 已加入台湾繁体评分标准：简体残留、大陆地区表达、非台湾医学用语会被扣分。
- 漏翻/目标语言检测已对繁體中文（台灣）增加简体残留识别，避免把明显简体输出误判为合格繁体。
- 字符串资源批量输出也支持繁體中文（台灣）。
- 浏览器标签页标题、页面 Header、网址参数均显示当前版本；本版本为第 36 个 main 提交，对应 `v0.0.36`。

## v0.0.35

- 已支持 Excel `.xlsx`、Word `.docx`、文本型 PDF 上传与翻译。
- PDF 第一阶段输出为 Word `.docx`：可复制文本会翻译为译文，PDF 中可提取图片会回填到导出的 Word 中。
- 已新增独立入口 `Multi-AI Review Lab`：复用 Translator 当前上传文件和目标语言，执行抽样、多模型候选翻译、匿名评审与 Markdown 报告导出。
- 多 AI 审核支持 Excel / DOCX / PDF 抽样；当前为均匀抽样，不是随机抽样。
- 多 AI 审核支持评审风格选择：
  - `Recommended`：按文件类型推荐，Excel 默认医学报告/表格解读，DOCX 默认说明书/IFU，PDF 默认 Auto。
  - `Auto / General medical`：由评审模型根据样本自行判断风格。
  - `Medical report / Table interpretation`：适合 Excel AI 解读、报告备注、表格单元格。
  - `Instructions for use / IFU`：适合说明书、操作手册。
  - `Marketing / User-readable`：适合产品介绍或面向用户的可读文案。
  - `Terminology-faithful / Low rewrite`：适合参数表、术语表、法规/标签类保守翻译。
- 多 AI 审核已增加失败诊断：候选模型或评审模型因区域限制、不可用、无分数返回时，会显示具体原因，不再把未评分误显示为 `0.00`。
- 版本号按远端 `main` 提交数递增；本版本为第 35 个 main 提交，对应 `v0.0.35`，页面 Header 显示版本号，网址会自动补充 `?v=0.0.35`。

## 已知限制

- PDF 图片内文字暂不 OCR 翻译。
- PDF 暂不做原 PDF 坐标级版式复原，当前以可编辑 Word 译文为第一阶段输出。
- 多 AI 审核依赖 OpenRouter 模型可用性；部分模型可能受区域或节点限制。
- Excel 解析仍使用 `xlsx`，npm audit 存在 high 公告且暂无官方修复版本；当前仅建议处理可信 `.xlsx` 文件。
