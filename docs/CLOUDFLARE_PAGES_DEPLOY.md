# Cloudflare Pages Deployment Guide

This guide deploys the app as a full workflow for other users:
upload `.xlsx` / `.docx` / text-based `.pdf` -> translate -> download. Excel `.xlsx` files can contain multiple worksheets; legacy `.xls` upload is intentionally disabled because style-safe writeback is unreliable.

## 1. Prerequisites
- Cloudflare account
- Node.js 18+
- Repository code pushed to Git provider (GitHub/GitLab)
- Cloudflare AI binding configured; optional DeepSeek secret for the fallback path.

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
- `REQUIRE_CF_ACCESS_EMAIL=true`

Optional encrypted Secret:
- `DEEPSEEK_API_KEY=<your_deepseek_key>` for official DeepSeek API fallback.

说明：
- Production should use `VITE_TRANSLATION_MODE=proxy`. Do not configure browser-side `VITE_*_API_KEY` secrets in Cloudflare Pages unless you intentionally want direct browser calls.
- Auto 模式按成本优先顺序执行：Cloudflare Gemini 3 Flash -> DeepSeek 官方 API `deepseek-v4-flash` -> DeepSeek 官方 API `deepseek-v4-pro` -> Cloudflare GPT-5.4 -> Cloudflare Claude 4.6 Sonnet。
- Multi-AI Review 会并发调用 5 个候选翻译模型，再由 3 个匿名强评审模型打分。
- 前端会从 `/api/me` 读取后端能力；只有 Cloudflare Pages 配置了 encrypted Secret `DEEPSEEK_API_KEY` 时，才在 Auto 后方显示 `DeepSeek Direct v4 Flash` 和 `DeepSeek Direct v4 Pro`。手工选择 Pro 时会向 DeepSeek 官方 API 指定 `deepseek-v4-pro`。
- OpenRouter 支持已移除；DeepSeek 走官方直连，GPT / Claude / Gemini 走 Cloudflare AI Gateway。
- 当某个模型因地区限制或 provider 不可用而失败时，站点会自动切到下一个模型，不需要用户手动重试。
- `DEEPSEEK_API_KEY` 必须是 Cloudflare encrypted Secret；不要把它写成 `VITE_DEEPSEEK_API_KEY`，否则生产浏览器 bundle 可能暴露密钥。

Access JWT verification (strongly recommended):
- 只信任 `CF-Access-Authenticated-User-Email` 请求头时，任何绕过 Access 的访问路径（例如未受保护的 `*.pages.dev` 或预览域名）都可以伪造身份。
- 在 Pages 环境变量里配置以下两项后，后端会校验 `Cf-Access-Jwt-Assertion`（RS256 签名、aud、iss、exp），并只使用 JWT 内的邮箱，忽略单独的邮箱请求头：
  - `CF_ACCESS_TEAM_DOMAIN=<your-team>.cloudflareaccess.com`
  - `CF_ACCESS_AUD=<Access Application 的 Application Audience (AUD) Tag>`
- 未配置时保持旧行为（只读邮箱请求头），所以上线前必须在 Cloudflare Zero Trust 确认 Access Application 覆盖了生产域名和所有预览域名。

Timeouts and retries (optional overrides, defaults shown):
- `CLOUDFLARE_AI_REQUEST_TIMEOUT_MS=60000`：单个 Cloudflare AI 模型的超时。超时后记为 `timeout` 并切换到下一个模型，而不是一直等待。
- `TRANSLATE_TOTAL_BUDGET_MS=90000`：`/api/translate` 单次请求内整条模型回退链的总时间预算。Cloudflare 约 100 秒会关闭代理请求，超出预算时服务端直接返回明确错误，而不是让客户端收到 524。
- `VITE_PROXY_REQUEST_TIMEOUT_MS=120000`：浏览器端单次翻译请求的超时（构建时变量），应大于服务端预算。
- DeepSeek 保持原有的单模型超时变量；各模型实际超时取自身超时与剩余预算中较小者。
- 客户端遇到服务商不可用类错误（超时、过载、网络、500）时，最多连续拆分 4 次且没有成功就停止，不再拆到每条记录一个请求；JSON 解析和对齐类错误仍会拆到单条。

Request limits (optional overrides, defaults shown):
- `MAX_REQUEST_BYTES=4194304`：单次请求体上限。
- `MAX_RECORDS_PER_REQUEST=200`：`/api/translate` 单次记录数上限（前端单批最多 40 条）。
- `MAX_SAMPLES_PER_REQUEST=100`：`/api/model-review`、`/api/review-samples` 单次样本数上限。
- 请求里指定的单个模型 ID 只允许字母、数字和 `._:/@+-`；`engine=openrouter` 会返回 400。
- 请求频率限制建议在 Cloudflare 的 WAF Rate Limiting 规则里配置（`/api/*`），代码层不做限流。

Public sharing (no Access) notes:
- 保持 `REQUIRE_CF_ACCESS_EMAIL` 为空或 `false`。
- 这样前端可直接调用 `/api/translate`，使用 Cloudflare AI binding 和 `DEEPSEEK_API_KEY`。

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
- Set spend limits on the Cloudflare AI Gateway and the DeepSeek account for budget control.
- Keep model temperature low for deterministic technical docs.
- Start with smaller DOCX for smoke tests before large manuals.
