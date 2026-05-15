import { getAuthContext, jsonResponse } from "../_shared/auth";

export const onRequestGet = async (context: any) => {
  const env = (context.env || {}) as Record<string, unknown>;
  const auth = getAuthContext(context.request, env);
  const whitelistEnabled = auth.allowedEmails.size > 0;
  const allowed = !whitelistEnabled || (Boolean(auth.userEmail) && auth.allowedEmails.has(auth.userEmail));
  const authenticated = Boolean(auth.userEmail) && allowed;

  if ((whitelistEnabled || auth.requireAccessEmail) && !authenticated) {
    return jsonResponse(
      {
        authenticated: false,
        email: auth.userEmail,
        accessEmail: auth.accessEmail,
        whitelistEnabled,
        requireAccessEmail: auth.requireAccessEmail,
        allowed
      },
      auth.userEmail ? 403 : 401
    );
  }

  return jsonResponse({
    authenticated,
    email: auth.userEmail,
    accessEmail: auth.accessEmail,
    whitelistEnabled,
    requireAccessEmail: auth.requireAccessEmail,
    allowed,
    localBypass: auth.isLocalBypass
  });
};
