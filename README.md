# POCT Medical Document Translator

面向 POCT 医疗文档的翻译与质检工具。支持 Excel/Word 文档导入导出，基于多模型翻译与规则校验流程完成批量医学术语翻译、组合规则核验与质量检查。

## 功能概览
- Excel/Word（.xlsx/.docx）导入导出，尽量保持原始结构与版式
- 多翻译引擎（DeepSeek/Gemini/OpenRouter）自动切换与失败回退
- 目标语言支持：中文、英语、西班牙语、法语、德语、意大利语、土耳其语、俄语、葡萄牙语
- 术语表与后处理：术语统一、占位符保护、标识符锁定
- 组合规则抽取与缺失组合提示
- 多 AI 交叉核验与质量检查（未翻译内容、空格与格式问题等）
- 翻译进度缓存与断点续传、可选的选择性翻译

## 技术栈
- React 19 + TypeScript + Vite
- xlsx / jszip（表格与文档处理）
- 多模型翻译服务适配（DeepSeek / Gemini / OpenRouter）

## 快速开始
1. 安装依赖
   ```bash
   npm install
   ```
2. 配置环境变量（新建 `.env.local`，文件已被 git 忽略）
   ```bash
   # 至少配置一个翻译引擎的 key
   VITE_DEEPSEEK_API_KEY=your_key
   GEMINI_API_KEY=your_key
   OPENROUTER_API_KEY=your_key
   ```
3. 启动开发环境
   ```bash
   npm run dev
   ```

## 常用脚本
- `npm run dev`：本地开发
- `npm run build`：生产构建
- `npm run preview`：本地预览
- `npm run deepseek:test`：DeepSeek 接口连通性测试
- `npm run docx:translate -- "<docx_path>" --target English`：离线批量翻译/验收脚本（运维辅助，不是最终用户入口）
- `npm run deploy:pages`：构建并发布到 Cloudflare Pages（需先 `wrangler login`）

## 云端部署
- Cloudflare Pages 部署清单见：
  - [`docs/CLOUDFLARE_PAGES_DEPLOY.md`](./docs/CLOUDFLARE_PAGES_DEPLOY.md)

## 说明
- 项目目录中的本地翻译前后文档不纳入版本控制（已在 `.gitignore` 中忽略）。
- 如需部署，请先配置对应的 API Key。

## 内部共享（简便安全版）
推荐用于“只给少数同事使用”的场景。

1. Cloudflare Access 做白名单登录  
   在 Zero Trust 里给你的站点或 `/api/*` 配 Access Policy，只允许指定邮箱访问。

2. 前端统一走代理模式  
   在 Cloudflare Pages 环境变量中设置：
   ```bash
   VITE_TRANSLATION_MODE=proxy
   ```
   这样浏览器只调用 `/api/translate`，不直接携带模型 Key。

3. 后端按邮箱分配 OpenRouter Key  
   在 Cloudflare Pages Functions 环境变量里配置：
   ```bash
   # 邮箱白名单（逗号分隔）
   ALLOWED_USER_EMAILS=user1@company.com,user2@company.com

   # 每个邮箱对应一把 Key（JSON）
   OPENROUTER_KEYS_BY_EMAIL={"user1@company.com":"sk-or-xxx","user2@company.com":"sk-or-yyy"}

   # 可选：未命中邮箱映射时的兜底 Key
   OPENROUTER_API_KEY=sk-or-fallback

   # 可选：本地调试（线上不要开）
   ALLOW_LOCAL_WITHOUT_ACCESS=false
   ```
   代码会读取 `CF-Access-Authenticated-User-Email`，未在白名单内直接拒绝。

4. 在 OpenRouter 给每把 Key 设置额度  
   给每个人那把 Key 设置 `limit` + `limit_reset=monthly`，即可限制每人每月花费。

5. 安全建议  
   不要在生产构建里设置 `VITE_*_API_KEY`，避免模型 Key 暴露给浏览器。

## 适用场景
- 医疗设备说明书、质控手册、检验参考区间等多语种版本同步
- 实验室/POCT 结果解读模板的多语言发布与更新
- 跨国注册或合规文件的初稿翻译与一致性检查
- 医疗机构内部培训材料、SOP 文档的批量翻译
- 供应链与售后支持的多语言知识库构建（FAQ、故障码说明）

## 潜能与演进方向
- 行业术语库可配置化与版本管理（不同医院/品牌差异）
- 引入“风格指南”与“审校模式”输出（规范化、可追溯）
- 支持更多格式（PDF/HTML/图片 OCR）与增量更新
- 人机协作：批注、审校流、修订历史与对照对齐
- 质检升级：医学实体一致性、数值范围校验、单位规范化
- 端到端流水线：翻译 → 规则校验 → 生成多语言发布包
