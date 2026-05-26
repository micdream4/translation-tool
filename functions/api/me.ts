import { getAuthContext, getOpenRouterKeyForUser, jsonResponse } from "../_shared/auth";

const getDeepSeekKey = (env: Record<string, unknown>) =>
  String(env.DEEPSEEK_API_KEY || env.Deepseek_API_KEY || "").trim();

const hasCloudflareAiBinding = (env: Record<string, unknown>) => {
  const binding = env.AI as { run?: unknown } | undefined;
  return Boolean(binding && typeof binding.run === "function");
};

const getTranslationCapabilities = (env: Record<string, unknown>, userEmail: string) => ({
  cloudflareAi: hasCloudflareAiBinding(env),
  deepseek: Boolean(getDeepSeekKey(env)),
  openrouter: Boolean(getOpenRouterKeyForUser(env, userEmail)),
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
