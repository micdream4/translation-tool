const TRUTHY = new Set(["1", "true", "yes", "on"]);

export type FunctionEnv = Record<string, unknown>;

export interface AuthContext {
  accessEmail: string;
  userEmail: string;
  allowLocalWithoutAccess: boolean;
  requireAccessEmail: boolean;
  isLocalBypass: boolean;
}

export interface AuthResult {
  ok: boolean;
  auth: AuthContext;
  response?: Response;
}

export const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });

export const normalizeEmail = (value: unknown) => String(value || "").trim().toLowerCase();

export const parseUserKeyMap = (raw: unknown) => {
  if (!raw) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== "object") return {} as Record<string, string>;
    const out: Record<string, string> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([email, key]) => {
      const normalizedEmail = normalizeEmail(email);
      const normalizedKey = String(key || "").trim();
      if (!normalizedEmail || !normalizedKey) return;
      out[normalizedEmail] = normalizedKey;
    });
    return out;
  } catch (error) {
    console.warn("Failed to parse OPENROUTER_KEYS_BY_EMAIL JSON.", error);
    return {} as Record<string, string>;
  }
};

export const getAccessEmail = (request: Request) =>
  normalizeEmail(
    request.headers.get("CF-Access-Authenticated-User-Email") ||
      request.headers.get("Cf-Access-Authenticated-User-Email") ||
      request.headers.get("cf-access-authenticated-user-email")
  );

export const getLocalBypassEmail = (request: Request, env: FunctionEnv) =>
  normalizeEmail(request.headers.get("x-user-email") || env.LOCAL_DEV_EMAIL);

export const getAuthContext = (request: Request, env: FunctionEnv): AuthContext => {
  const allowLocalWithoutAccess = TRUTHY.has(
    String(env.ALLOW_LOCAL_WITHOUT_ACCESS || "").trim().toLowerCase()
  );
  const requireAccessEmail = TRUTHY.has(
    String(env.REQUIRE_CF_ACCESS_EMAIL || "").trim().toLowerCase()
  );
  const accessEmail = getAccessEmail(request);
  const localBypassEmail = allowLocalWithoutAccess ? getLocalBypassEmail(request, env) : "";
  const userEmail = accessEmail || localBypassEmail;

  return {
    accessEmail,
    userEmail,
    allowLocalWithoutAccess,
    requireAccessEmail,
    isLocalBypass: Boolean(!accessEmail && localBypassEmail)
  };
};

export const enforceRequestAuth = (request: Request, env: FunctionEnv): AuthResult => {
  const auth = getAuthContext(request, env);
  const localHint = auth.allowLocalWithoutAccess
    ? " Set LOCAL_DEV_EMAIL or send x-user-email for local testing."
    : "";

  if (!auth.userEmail && auth.requireAccessEmail) {
    return {
      ok: false,
      auth,
      response: jsonResponse(
        { error: `Unauthorized: missing Cloudflare Access user email.${localHint}` },
        401
      )
    };
  }

  return { ok: true, auth };
};

export const getOpenRouterKeyForUser = (env: FunctionEnv, userEmail: string) => {
  const userKeyMap = parseUserKeyMap(env.OPENROUTER_KEYS_BY_EMAIL || env.OPENROUTER_KEY_BY_EMAIL);
  const defaultOpenRouterKey = String(
    env.OPENROUTER_API_KEY || env.Openrouter_API_KEY || env.VITE_OPENROUTER_API_KEY || ""
  ).trim();
  return String(userKeyMap[userEmail] || defaultOpenRouterKey || "").trim();
};
