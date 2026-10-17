import { getAuthContext, jsonResponse } from "../_shared/auth";
import { parseEngineOrder } from "../../utils/engineOrder";
import { hasCloudflareAiBinding, getDeepSeekKey, parseDelimitedModelList } from "../_shared/llmProviders";

// The browser builds its model menu from this; wrangler.toml [vars] never reach the Vite build.
const getCloudflareAiMenuModels = (env: Record<string, unknown>) => {
  const all = parseDelimitedModelList(env.CLOUDFLARE_AI_MODELS || env.CLOUDFLARE_AI_MODEL || env.VITE_CLOUDFLARE_AI_MODELS);
  const primary = parseDelimitedModelList(env.CLOUDFLARE_AI_PRIMARY_MODELS, all.slice(0, 1));
  const fallback = parseDelimitedModelList(env.CLOUDFLARE_AI_FALLBACK_MODELS, all.slice(1));
  return Array.from(new Set([...primary, ...fallback]));
};

const getTranslationCapabilities = (env: Record<string, unknown>) => {
  const cloudflareAiModels = getCloudflareAiMenuModels(env);
  const deepseekModels = parseDelimitedModelList(env.DEEPSEEK_MODELS || env.DEEPSEEK_MODEL || env.VITE_DEEPSEEK_MODELS);
  return {
    cloudflareAi: hasCloudflareAiBinding(env),
    deepseek: Boolean(getDeepSeekKey(env)),
    gemini: false,
    engineOrder: parseEngineOrder(env.TRANSLATION_ENGINE_ORDER),
    ...(cloudflareAiModels.length ? { cloudflareAiModels } : {}),
    ...(deepseekModels.length ? { deepseekModels } : {})
  };
};

export const onRequestGet = async (context: any) => {
  const env = (context.env || {}) as Record<string, unknown>;
  const auth = await getAuthContext(context.request, env);
  const authenticated = Boolean(auth.userEmail);

  if (auth.requireAccessEmail && !authenticated) {
    return jsonResponse(
      {
        authenticated: false,
        email: auth.userEmail,
        accessEmail: auth.accessEmail,
        requireAccessEmail: auth.requireAccessEmail,
        accessControlledBy: "cloudflare-zero-trust",
        translationCapabilities: getTranslationCapabilities(env)
      },
      401
    );
  }

  return jsonResponse({
    authenticated,
    email: auth.userEmail,
    accessEmail: auth.accessEmail,
    requireAccessEmail: auth.requireAccessEmail,
    accessControlledBy: "cloudflare-zero-trust",
    localBypass: auth.isLocalBypass,
    translationCapabilities: getTranslationCapabilities(env)
  });
};
