import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const deepseekKey = env.VITE_DEEPSEEK_API_KEY || env.Deepseek_API_KEY || env.DEEPSEEK_API_KEY || '';
    const openRouterKey =
      env.OPENROUTER_API_KEY ||
      env.VITE_OPENROUTER_API_KEY ||
      env.Openrouter_API_KEY ||
      env.OpenRouter_API_KEY ||
      env.VITE_Openrouter_API_KEY ||
      env.VITE_OpenRouter_API_KEY ||
      '';
    const openRouterModel =
      env.OPENROUTER_MODEL ||
      env.VITE_OPENROUTER_MODEL ||
      env.Openrouter_MODEL ||
      env.VITE_Openrouter_MODEL ||
      '';

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.VITE_DEEPSEEK_API_KEY': JSON.stringify(deepseekKey),
        'process.env.Deepseek_API_KEY': JSON.stringify(deepseekKey),
        'process.env.DEEPSEEK_API_KEY': JSON.stringify(deepseekKey),
        'import.meta.env.VITE_DEEPSEEK_API_KEY': JSON.stringify(deepseekKey),
        'process.env.OPENROUTER_API_KEY': JSON.stringify(openRouterKey),
        'process.env.VITE_OPENROUTER_API_KEY': JSON.stringify(openRouterKey),
        'process.env.Openrouter_API_KEY': JSON.stringify(openRouterKey),
        'process.env.VITE_Openrouter_API_KEY': JSON.stringify(openRouterKey),
        'import.meta.env.OPENROUTER_API_KEY': JSON.stringify(openRouterKey),
        'import.meta.env.VITE_OPENROUTER_API_KEY': JSON.stringify(openRouterKey),
        'import.meta.env.Openrouter_API_KEY': JSON.stringify(openRouterKey),
        'import.meta.env.VITE_Openrouter_API_KEY': JSON.stringify(openRouterKey),
        'process.env.OPENROUTER_MODEL': JSON.stringify(openRouterModel),
        'process.env.VITE_OPENROUTER_MODEL': JSON.stringify(openRouterModel),
        'process.env.Openrouter_MODEL': JSON.stringify(openRouterModel),
        'process.env.VITE_Openrouter_MODEL': JSON.stringify(openRouterModel),
        'import.meta.env.OPENROUTER_MODEL': JSON.stringify(openRouterModel),
        'import.meta.env.VITE_OPENROUTER_MODEL': JSON.stringify(openRouterModel),
        'import.meta.env.Openrouter_MODEL': JSON.stringify(openRouterModel),
        'import.meta.env.VITE_Openrouter_MODEL': JSON.stringify(openRouterModel)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
