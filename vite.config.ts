import path from 'path';
import { readFileSync } from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const appVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
).version;

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const translationMode = (env.VITE_TRANSLATION_MODE || '').toLowerCase().trim();
    const allowClientKeys = translationMode === 'direct';
    const geminiKey = allowClientKeys ? env.VITE_GEMINI_API_KEY || '' : '';
    const deepseekKey = allowClientKeys ? env.VITE_DEEPSEEK_API_KEY || '' : '';
    const openRouterKey = allowClientKeys
      ? env.VITE_OPENROUTER_API_KEY ||
        env.VITE_Openrouter_API_KEY ||
        env.VITE_OpenRouter_API_KEY ||
        ''
      : '';
    const openRouterModel =
      env.OPENROUTER_MODEL ||
      env.VITE_OPENROUTER_MODEL ||
      env.Openrouter_MODEL ||
      env.VITE_Openrouter_MODEL ||
      '';
    const localPagesFunctionPlugin = {
      name: 'local-pages-functions',
      configureServer(server: any) {
        server.middlewares.use('/api/model-review', async (req: any, res: any) => {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Method not allowed.' }));
            return;
          }

          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }

            const headers = new Headers();
            Object.entries(req.headers || {}).forEach(([key, value]) => {
              if (Array.isArray(value)) {
                value.forEach((item) => headers.append(key, item));
              } else if (value !== undefined) {
                headers.set(key, String(value));
              }
            });

            const host = req.headers.host || '127.0.0.1:3000';
            const request = new Request(`http://${host}${req.url}`, {
              method: req.method,
              headers,
              body: Buffer.concat(chunks)
            });
            const mod = await server.ssrLoadModule('/functions/api/model-review.ts');
            const response: Response = await mod.onRequestPost({ request, env });

            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            res.end(Buffer.from(await response.arrayBuffer()));
          } catch (error: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: error?.message || 'Local function error.' }));
          }
        });
      }
    };

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), localPagesFunctionPlugin],
      define: {
        'process.env.API_KEY': JSON.stringify(geminiKey),
        'process.env.GEMINI_API_KEY': JSON.stringify(geminiKey),
        'import.meta.env.API_KEY': JSON.stringify(geminiKey),
        'import.meta.env.GEMINI_API_KEY': JSON.stringify(geminiKey),
        'process.env.VITE_DEEPSEEK_API_KEY': JSON.stringify(deepseekKey),
        'import.meta.env.VITE_DEEPSEEK_API_KEY': JSON.stringify(deepseekKey),
        'process.env.OPENROUTER_API_KEY': JSON.stringify(''),
        'process.env.VITE_OPENROUTER_API_KEY': JSON.stringify(openRouterKey),
        'process.env.Openrouter_API_KEY': JSON.stringify(''),
        'process.env.VITE_Openrouter_API_KEY': JSON.stringify(openRouterKey),
        'import.meta.env.OPENROUTER_API_KEY': JSON.stringify(''),
        'import.meta.env.VITE_OPENROUTER_API_KEY': JSON.stringify(openRouterKey),
        'import.meta.env.Openrouter_API_KEY': JSON.stringify(''),
        'import.meta.env.VITE_Openrouter_API_KEY': JSON.stringify(openRouterKey),
        'process.env.OPENROUTER_MODEL': JSON.stringify(openRouterModel),
        'process.env.VITE_OPENROUTER_MODEL': JSON.stringify(openRouterModel),
        'process.env.Openrouter_MODEL': JSON.stringify(openRouterModel),
        'process.env.VITE_Openrouter_MODEL': JSON.stringify(openRouterModel),
        'import.meta.env.OPENROUTER_MODEL': JSON.stringify(openRouterModel),
        'import.meta.env.VITE_OPENROUTER_MODEL': JSON.stringify(openRouterModel),
        'import.meta.env.Openrouter_MODEL': JSON.stringify(openRouterModel),
        'import.meta.env.VITE_Openrouter_MODEL': JSON.stringify(openRouterModel),
        'process.env.VITE_APP_VERSION': JSON.stringify(appVersion),
        'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
