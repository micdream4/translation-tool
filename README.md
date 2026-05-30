# POCT Medical Document Translator

面向 POCT 医疗文档的翻译与质检工具。支持 Excel/Word/PDF 文档导入，基于多模型翻译与规则校验流程完成批量医学术语翻译、组合规则核验与质量检查。

## 功能概览
- Excel（.xlsx，多工作表）/Word（.docx）导入导出，尽量保持原始结构与版式
- 文本型 PDF 导入，抽取可复制文本后翻译，并导出仅含译文且回填可提取图片的 Word（.docx）
- 多翻译引擎（DeepSeek/Gemini/OpenRouter）自动切换与失败回退
- 目标语言支持：简体中文、繁體中文（台灣）、英语、西班牙语、法语、德语、意大利语、土耳其语、俄语、葡萄牙语
- 术语表与后处理：术语统一、占位符保护、标识符锁定
- 组合规则抽取与缺失组合提示
- 多 AI 交叉核验与质量检查（未翻译内容、空格与格式问题等）
- 翻译进度缓存与断点续传、可选的选择性翻译

## 技术栈
- React 19 + TypeScript + Vite
- xlsx / jszip / pdfjs-dist / docx（表格、文档与 PDF 文本处理）
- 多模型翻译服务适配（Cloudflare AI Gateway / OpenRouter / DeepSeek / Gemini）

## 快速开始
1. 安装依赖
   ```bash
   npm install
   ```
2. 配置环境变量（新建 `.env.local`，文件已被 git 忽略）
   ```bash
   # 推荐：本地也走代理模式，避免把模型 Key 注入浏览器 bundle
   VITE_TRANSLATION_MODE=proxy
   # 生产环境 Auto 优先走 Cloudflare AI Gateway，再走 DeepSeek 官方 API，OpenRouter 仅作显式兜底
   CLOUDFLARE_AI_MODELS=google/gemini-3-flash,openai/gpt-5.4,anthropic/claude-sonnet-4.6
   DEEPSEEK_API_KEY=your_deepseek_key
   DEEPSEEK_MODELS=deepseek-v4-flash
   OPENROUTER_API_KEY=your_key
   OPENROUTER_MODELS=
   ```
   如需本地纯浏览器直连模型，显式设置 `VITE_TRANSLATION_MODE=direct` 后再使用 `VITE_*_API_KEY`。
3. 启动开发环境
   ```bash
   npm run dev
   ```

## 常用脚本
- `npm run dev`：本地开发
- `npm run build`：生产构建
- `npm run preview`：本地预览
- `npm run test`：运行轻量回归检查（多工作表 Excel、上传格式、安全配置、DOCX 范围提示、PDF 文本导出路径）
- `npm run smoke:openrouter`：用当前 OpenRouter key 实测模型可用性，不输出密钥
- `npm run deepseek:test`：DeepSeek 接口连通性测试
- `npm run docx:translate -- "<docx_path>" --target English`：离线批量翻译/验收脚本（运维辅助，不是最终用户入口）
- `npm run deploy:pages`：构建并发布到 Cloudflare Pages（需先 `wrangler login`）

## 云端部署
- Cloudflare Pages 部署清单见：
  - [`docs/CLOUDFLARE_PAGES_DEPLOY.md`](./docs/CLOUDFLARE_PAGES_DEPLOY.md)
- 当前项目进度见：
  - [`docs/PROJECT_PROGRESS.md`](./docs/PROJECT_PROGRESS.md)

## 说明
- 项目目录中的本地翻译前后文档不纳入版本控制（已在 `.gitignore` 中忽略）。
- 如需部署，请先在 Cloudflare Pages 环境变量里配置服务端 API Key；生产构建不要设置浏览器端 `VITE_*_API_KEY`。

## 内部共享（简便安全版）
推荐用于“只给少数同事使用”的场景。

1. Cloudflare Access 做白名单登录  
   在 Zero Trust 里给你的站点或 `/api/*` 配 Access Policy，只允许指定邮箱访问。

2. 前端统一走代理模式  
   在 Cloudflare Pages 环境变量中设置：
   ```bash
   VITE_TRANSLATION_MODE=proxy
   VITE_PROXY_ENGINES=cloudflare-ai,openrouter
   ```
   这样浏览器只调用 `/api/translate`，不直接携带模型 Key。

3. 后端使用 Cloudflare Access 身份  
   在 Cloudflare Pages Functions 环境变量里配置：
   ```bash
   # 每个邮箱对应一把 Key（JSON）
   OPENROUTER_KEYS_BY_EMAIL={"user1@company.com":"sk-or-xxx","user2@company.com":"sk-or-yyy"}

   # 可选：未命中邮箱映射时的兜底 Key
   OPENROUTER_API_KEY=sk-or-fallback

   # 可选：DeepSeek 官方 API 直连，Auto 会在 Cloudflare Gemini 失败后优先尝试它
   DEEPSEEK_API_KEY=sk-deepseek
   DEEPSEEK_MODELS=deepseek-v4-flash

   # 可选：OpenRouter 最后兜底模型列表；默认留空，不再通过 OpenRouter 调国内模型。
   OPENROUTER_MODELS=

   # 可选：本地调试（线上不要开）
   ALLOW_LOCAL_WITHOUT_ACCESS=false

   # 可选：当你已配置 Cloudflare Access 时再开启
   REQUIRE_CF_ACCESS_EMAIL=true
   ```
   开启 `REQUIRE_CF_ACCESS_EMAIL=true` 后，代码会读取
   `CF-Access-Authenticated-User-Email`；允许访问的邮箱只在 Cloudflare Zero Trust Access Policy 中维护。
   前端会调用 `/api/me` 显示当前访问状态；翻译、抽样审核和 Multi-AI Review API 使用同一套认证规则。

4. 在 OpenRouter 给每把 Key 设置额度  
   给每个人那把 Key 设置 `limit` + `limit_reset=monthly`，即可限制每人每月花费。

5. 安全建议  
   不要在生产构建里设置 `VITE_*_API_KEY`，避免模型 Key 暴露给浏览器。生产直连 DeepSeek 应使用服务端 Secret `DEEPSEEK_API_KEY`，不要使用 `VITE_DEEPSEEK_API_KEY`。
   配置 `DEEPSEEK_API_KEY` 后，左侧 `Translation Model` 会显示 `DeepSeek Direct v4 Flash` 和 `DeepSeek Direct v4 Pro`；Auto 默认只使用 `deepseek-v4-flash` 作为 DeepSeek 官方 fallback。
   当前默认 OpenRouter 链为空；Gemini、GPT 和 Claude 统一通过 Cloudflare AI Gateway 调用，DeepSeek 通过官方 API 直连。若后续确实需要 OpenRouter 兜底，可先用 `npm run smoke:openrouter` 验证，再通过 `OPENROUTER_MODELS` / `VITE_OPENROUTER_MODELS` 显式加入。

6. DOCX 范围说明
   浏览器端 DOCX 翻译当前处理正文 `word/document.xml` 的段落/表格文本；页眉页脚、脚注/尾注、批注会在上传后提示为暂不翻译范围。

7. PDF 范围说明
   浏览器端 PDF 翻译当前处理“可抽取文本”的 PDF，并导出为仅含译文的 Word（.docx）。PDF 中可提取的图片会按页插入到对应译文段落后；扫描版 PDF、图片内文字 OCR、复杂坐标级版式复原暂不支持。

8. 繁體中文（台灣）说明
   目标语言中的 `Traditional Chinese (Taiwan)` 按台湾地区繁体表达处理，不只是简繁字符转换；翻译与审核 prompt 会要求使用台湾常见医学/技术用语，并在质量检查中把明显简体残留视为未达目标语言。

9. 依赖安全说明
   `xlsx` 当前仍有 npm audit 公告且上游暂无修复版本；本项目已禁用旧 `.xls` 上传，仅支持可信来源的 `.xlsx` 文件。若后续需要处理外部不可信 Excel，应优先评估迁移到维护更活跃的解析库或服务端隔离解析。

## 适用场景
- 医疗设备说明书、质控手册、检验参考区间等多语种版本同步
- 实验室/POCT 结果解读模板的多语言发布与更新
- 跨国注册或合规文件的初稿翻译与一致性检查
- 医疗机构内部培训材料、SOP 文档的批量翻译
- 供应链与售后支持的多语言知识库构建（FAQ、故障码说明）

## 潜能与演进方向
- 行业术语库可配置化与版本管理（不同医院/品牌差异）
- 引入“风格指南”与“审校模式”输出（规范化、可追溯）
- 支持更多格式（HTML/图片 OCR）与 PDF 版式增强
- 人机协作：批注、审校流、修订历史与对照对齐
- 质检升级：医学实体一致性、数值范围校验、单位规范化
- 端到端流水线：翻译 → 规则校验 → 生成多语言发布包
