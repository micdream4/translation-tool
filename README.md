# POCT Medical Document Translator

面向 POCT 医疗文档的翻译与质检工具。支持 Excel/Word 文档导入导出，基于多模型翻译与规则校验流程完成批量医学术语翻译、组合规则核验与质量检查。

## 功能概览
- Excel/Word（.xlsx/.docx）导入导出，尽量保持原始结构与版式
- 多翻译引擎（DeepSeek/Gemini/OpenRouter）自动切换与失败回退
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

## 说明
- 项目目录中的本地翻译前后文档不纳入版本控制（已在 `.gitignore` 中忽略）。
- 如需部署，请先配置对应的 API Key。
