# Cloudflare Pages Deployment Guide

This guide deploys the app as a full workflow for other users:
upload `.xlsx` / `.docx` / text-based `.pdf` -> translate -> download. Excel `.xlsx` files can contain multiple worksheets; legacy `.xls` upload is intentionally disabled because style-safe writeback is unreliable.

## 1. Prerequisites
- Cloudflare account
- Node.js 18+
- Repository code pushed to Git provider (GitHub/GitLab)
- Cloudflare AI binding configured; optional DeepSeek / OpenRouter secrets for fallback paths.

## 2. Create Pages Project
1. Open Cloudflare Dashboard -> `Workers & Pages` -> `Create` -> `Pages`.
2. Connect your repository.
3. Build settings:
   - Build command: `npm run build`
   - Build output directory: `dist`

## 3. Configure Environment Variables
Set these in Cloudflare Pages project -> `Settings` -> `Environment variables`.

Required:
- Cloudflare AI Gateway credits or BYOK configured for `google/gemini-3-flash`.

Non-sensitive controlled-sharing config is managed in `wrangler.toml` under `[vars]`, so it remains readable and editable in git:
- `VITE_TRANSLATION_MODE=proxy`
- `VITE_PROXY_ENGINES=cloudflare-ai`
- `CLOUDFLARE_AI_MODELS=google/gemini-3-flash,openai/gpt-5.4,anthropic/claude-sonnet-4.6`
- `CLOUDFLARE_AI_PRIMARY_MODELS=google/gemini-3-flash`
- `CLOUDFLARE_AI_FALLBACK_MODELS=openai/gpt-5.4,anthropic/claude-sonnet-4.6`
- `CLOUDFLARE_AI_GATEWAY_ID=default`
- `CLOUDFLARE_AI_MAX_OUTPUT_TOKENS=8192`
- `CLOUDFLARE_REVIEW_TRANSLATION_MODELS=cloudflare-ai:google/gemini-3-flash,deepseek:deepseek-v4-flash,deepseek:deepseek-v4-pro,cloudflare-ai:openai/gpt-5.4,cloudflare-ai:anthropic/claude-sonnet-4.6`
- `CLOUDFLARE_REVIEW_JUDGE_MODELS=cloudflare-ai:openai/gpt-5.4,cloudflare-ai:anthropic/claude-sonnet-4.6,deepseek:deepseek-v4-pro`
- `DEEPSEEK_MODELS=deepseek-v4-flash,deepseek-v4-pro`
- `DEEPSEEK_REQUEST_TIMEOUT_MS=90000`
- `OPENROUTER_MODELS=` (empty by default; use only as explicit last fallback)
- `REQUIRE_CF_ACCESS_EMAIL=true`

Optional encrypted Secret:
- `OPENROUTER_KEYS_BY_EMAIL={"user1@company.com":"sk-or-xxx","user2@company.com":"sk-or-yyy"}`
- `DEEPSEEK_API_KEY=<your_deepseek_key>` for official DeepSeek API fallback.
- `OPENROUTER_API_KEY=<your_key>` for explicit OpenRouter last fallback.

说明：
- Production should use `VITE_TRANSLATION_MODE=proxy`. Do not configure browser-side `VITE_*_API_KEY` secrets in Cloudflare Pages unless you intentionally want direct browser calls.
- Auto 模式按成本优先顺序执行：Cloudflare Gemini 3 Flash -> DeepSeek 官方 API `deepseek-v4-flash` -> DeepSeek 官方 API `deepseek-v4-pro` -> Cloudflare GPT-5.4 -> Cloudflare Claude 4.6 Sonnet；最后才按 `OPENROUTER_MODELS` 顺序尝试 OpenRouter 模型。
- Multi-AI Review 会并发调用 5 个候选翻译模型，再由 3 个匿名强评审模型打分；默认不使用 OpenRouter。
- 前端会从 `/api/me` 读取后端能力；只有 Cloudflare Pages 配置了 encrypted Secret `DEEPSEEK_API_KEY` 时，才在 Auto 后方显示 `DeepSeek Direct v4 Flash` 和 `DeepSeek Direct v4 Pro`。手工选择 Pro 时会向 DeepSeek 官方 API 指定 `deepseek-v4-pro`。
- OpenRouter 默认留空，不再通过 OpenRouter 调 Qwen / DeepSeek；DeepSeek 走官方直连，GPT / Claude / Gemini 走 Cloudflare AI Gateway。若后续需要 OpenRouter 兜底，先用 `npm run smoke:openrouter` 验证，再通过 `OPENROUTER_MODELS` / `VITE_OPENROUTER_MODELS` 显式加入。
- 如果配置了 `OPENROUTER_MODELS`，后端会按顺序尝试这些 OpenRouter 模型，直到某个模型成功。
- `OPENROUTER_MODEL` 仍可保留给单模型场景；多模型时优先使用 `OPENROUTER_MODELS`。
- 当某个模型因地区限制或 provider 不可用而失败时，站点会自动切到下一个模型，不需要用户手动重试。
- `DEEPSEEK_API_KEY` 必须是 Cloudflare encrypted Secret；不要把它写成 `VITE_DEEPSEEK_API_KEY`，否则生产浏览器 bundle 可能暴露密钥。

Public sharing (no Access) notes:
- 保持 `REQUIRE_CF_ACCESS_EMAIL` 为空或 `false`。
- 这样前端可直接调用 `/api/translate`，仅使用 `OPENROUTER_API_KEY`。

## 4. Protect Access (Recommended)
Use Cloudflare Zero Trust Access policy:
- protect your site and/or `/api/*`
- allow only your team emails

The server reads `CF-Access-Authenticated-User-Email` and requires a Cloudflare Access identity when `REQUIRE_CF_ACCESS_EMAIL=true`. Email allow/deny lists are managed only in the Cloudflare Zero Trust Access policy.
The frontend reads `/api/me` to show the current user or blocked/guest state in the header. Use the same Access policy for the whole site if you want the UI itself hidden before login; use `/api/*` protection only if public viewing is acceptable but model calls must be gated.

## 5. Deploy
If deploying from local CLI:
1. `npx wrangler login`
2. `npm run deploy:pages`

The project pins `wrangler` in `devDependencies`, so `npm run deploy:pages` uses the repository version instead of an arbitrary global install.

If deploying from Git integration:
- push to your configured branch, Cloudflare auto-builds and deploys.

## 6. Post-Deploy Checklist
1. Open site URL
2. Upload a small `.docx` or text-based `.pdf`
3. Run translation (for example Chinese -> English)
4. Download output and verify:
   - layout intact
   - images intact
   - translated text updated
   - if the document has headers, footers, footnotes, endnotes, or comments, confirm the DOCX coverage summary includes the expected XML parts
   - for PDF, confirm the translated PDF keeps the expected page background/images and exposes an extractable text layer; use Review DOCX for secondary text review
   - before release, run `npm run test:quality-gate` on the Mac that owns the ignored `local-data/` regression samples; GitHub CI intentionally runs `test:ci-gate` only

## 7. Cost and Stability Tips
- Use `OPENROUTER_KEYS_BY_EMAIL` for per-user budget control.
- Keep model temperature low for deterministic technical docs.
- Start with smaller DOCX for smoke tests before large manuals.
