import { getAuthContext, getOpenRouterKeyForUser, jsonResponse } from "../_shared/auth";
import { hasCloudflareAiBinding, getDeepSeekKey, parseDelimitedModelList } from "../_shared/llmProviders";

const hasOpenRouterModels = (env: Record<string, unknown>) =>
  parseDelimitedModelList(
    env.OPENROUTER_MODELS ||
      env.VITE_OPENROUTER_MODELS ||
      env.OPENROUTER_MODEL ||
      env.VITE_OPENROUTER_MODEL,
    []
  ).length > 0;

const getTranslationCapabilities = (env: Record<string, unknown>, userEmail: string) => ({
  cloudflareAi: hasCloudflareAiBinding(env),
  deepseek: Boolean(getDeepSeekKey(env)),
  openrouter: Boolean(getOpenRouterKeyForUser(env, userEmail) && hasOpenRouterModels(env)),
  gemini: false
});

export const onRequestGet = async (context: any) => {
  const env = (context.env || {}) as Record<string, unknown>;
  const auth = getAuthContext(context.request, env);
  const authenticated = Boolean(auth.userEmail);

  if (auth.requireAccessEmail && !authenticated) {
    return jsonResponse(
      {
        authenticated: false,
        email: auth.userEmail,
        accessEmail: auth.accessEmail,
        requireAccessEmail: auth.requireAccessEmail,
        accessControlledBy: "cloudflare-zero-trust",
        translationCapabilities: getTranslationCapabilities(env, auth.userEmail)
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
    translationCapabilities: getTranslationCapabilities(env, auth.userEmail)
  });
};
