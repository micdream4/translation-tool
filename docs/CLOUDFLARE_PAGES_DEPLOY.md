# Cloudflare Pages Deployment Guide

This guide deploys the app as a full workflow for other users:
upload `.xlsx/.docx` -> translate -> download.

## 1. Prerequisites
- Cloudflare account
- Node.js 18+
- Repository code pushed to Git provider (GitHub/GitLab)
- At least one model key (recommended: OpenRouter)

## 2. Create Pages Project
1. Open Cloudflare Dashboard -> `Workers & Pages` -> `Create` -> `Pages`.
2. Connect your repository.
3. Build settings:
   - Build command: `npm run build`
   - Build output directory: `dist`

## 3. Configure Environment Variables
Set these in Cloudflare Pages project -> `Settings` -> `Environment variables`.

Required:
- `VITE_TRANSLATION_MODE=proxy`
- `OPENROUTER_API_KEY=<your_key>`

Recommended for controlled sharing:
- `ALLOWED_USER_EMAILS=user1@company.com,user2@company.com`
- `OPENROUTER_KEYS_BY_EMAIL={"user1@company.com":"sk-or-xxx","user2@company.com":"sk-or-yyy"}`
- `OPENROUTER_MODEL=google/gemini-3-flash-preview`
- `ALLOW_LOCAL_WITHOUT_ACCESS=false`
- `REQUIRE_CF_ACCESS_EMAIL=true`（仅当你已配置 Cloudflare Access 并希望强制登录邮箱身份时开启）

Public sharing (no Access) notes:
- 不配置 `ALLOWED_USER_EMAILS` 且保持 `REQUIRE_CF_ACCESS_EMAIL` 为空或 `false`。
- 这样前端可直接调用 `/api/translate`，仅使用 `OPENROUTER_API_KEY`。

## 4. Protect Access (Recommended)
Use Cloudflare Zero Trust Access policy:
- protect your site and/or `/api/*`
- allow only your team emails

The server reads `CF-Access-Authenticated-User-Email` and rejects non-whitelisted users.

## 5. Deploy
If deploying from local CLI:
1. `npx wrangler login`
2. `npm run deploy:pages`

If deploying from Git integration:
- push to your configured branch, Cloudflare auto-builds and deploys.

## 6. Post-Deploy Checklist
1. Open site URL
2. Upload a small `.docx`
3. Run translation (for example Chinese -> English)
4. Download output and verify:
   - layout intact
   - images intact
   - translated text updated

## 7. Cost and Stability Tips
- Use `OPENROUTER_KEYS_BY_EMAIL` for per-user budget control.
- Keep model temperature low for deterministic technical docs.
- Start with smaller DOCX for smoke tests before large manuals.
