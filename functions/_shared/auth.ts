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

const base64UrlToBytes = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const decodeJwtPart = (value: string) =>
  JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as Record<string, unknown>;

type AccessJwk = JsonWebKey & { kid?: string };
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
const jwksCache = new Map<string, { keys: AccessJwk[]; fetchedAt: number }>();

const getAccessTeamDomain = (env: FunctionEnv) =>
  String(env.CF_ACCESS_TEAM_DOMAIN || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");

const getAccessAudience = (env: FunctionEnv) => String(env.CF_ACCESS_AUD || "").trim();

export const isAccessJwtVerificationConfigured = (env: FunctionEnv) =>
  Boolean(getAccessTeamDomain(env) && getAccessAudience(env));

const getAccessJwks = async (teamDomain: string, forceRefresh = false) => {
  const cached = jwksCache.get(teamDomain);
  if (cached && !forceRefresh && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cached.keys;
  }
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs request failed with ${response.status}.`);
  const payload = (await response.json()) as { keys?: AccessJwk[] };
  const keys = Array.isArray(payload?.keys) ? payload.keys : [];
  jwksCache.set(teamDomain, { keys, fetchedAt: Date.now() });
  return keys;
};

const getAccessJwtToken = (request: Request) => {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header.trim();
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? match[1].trim() : "";
};

/**
 * Verifies the Cloudflare Access JWT (RS256 signature, audience, issuer, expiry)
 * and returns the authenticated email, or "" when the token is missing or invalid.
 */
export const verifyAccessJwtEmail = async (request: Request, env: FunctionEnv) => {
  const teamDomain = getAccessTeamDomain(env);
  const audience = getAccessAudience(env);
  const token = getAccessJwtToken(request);
  if (!teamDomain || !audience || !token) return "";

  try {
    const [rawHeader, rawPayload, rawSignature] = token.split(".");
    if (!rawHeader || !rawPayload || !rawSignature) return "";
    const header = decodeJwtPart(rawHeader);
    const payload = decodeJwtPart(rawPayload);
    if (header.alg !== "RS256") return "";

    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(audience)) return "";
    if (payload.iss !== `https://${teamDomain}`) return "";
    if (typeof payload.exp !== "number" || payload.exp <= now) return "";
    if (typeof payload.nbf === "number" && payload.nbf > now + 60) return "";

    let keys = await getAccessJwks(teamDomain);
    let jwk = keys.find((key) => key.kid === header.kid);
    if (!jwk) {
      keys = await getAccessJwks(teamDomain, true);
      jwk = keys.find((key) => key.kid === header.kid);
    }
    if (!jwk) return "";

    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      base64UrlToBytes(rawSignature),
      new TextEncoder().encode(`${rawHeader}.${rawPayload}`)
    );
    return valid ? normalizeEmail(payload.email) : "";
  } catch (error) {
    console.warn("Cloudflare Access JWT verification failed.", error);
    return "";
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

export const getAuthContext = async (request: Request, env: FunctionEnv): Promise<AuthContext> => {
  const allowLocalWithoutAccess = TRUTHY.has(
    String(env.ALLOW_LOCAL_WITHOUT_ACCESS || "").trim().toLowerCase()
  );
  const requireAccessEmail = TRUTHY.has(
    String(env.REQUIRE_CF_ACCESS_EMAIL || "").trim().toLowerCase()
  );
  // When CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are configured, the identity header alone is
  // not trusted: a request that bypasses Cloudflare Access cannot present a validly signed JWT.
  const accessEmail = isAccessJwtVerificationConfigured(env)
    ? await verifyAccessJwtEmail(request, env)
    : getAccessEmail(request);
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

export const enforceRequestAuth = async (request: Request, env: FunctionEnv): Promise<AuthResult> => {
  const auth = await getAuthContext(request, env);
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

