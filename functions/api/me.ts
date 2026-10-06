import { getAuthContext, jsonResponse } from "../_shared/auth";
import { hasCloudflareAiBinding, getDeepSeekKey, parseDelimitedModelList } from "../_shared/llmProviders";

const getTranslationCapabilities = (env: Record<string, unknown>) => ({
  cloudflareAi: hasCloudflareAiBinding(env),
  deepseek: Boolean(getDeepSeekKey(env)),
  gemini: false
});

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
