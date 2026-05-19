import { getAuthContext, jsonResponse } from "../_shared/auth";

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
        accessControlledBy: "cloudflare-zero-trust"
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
    localBypass: auth.isLocalBypass
  });
};
