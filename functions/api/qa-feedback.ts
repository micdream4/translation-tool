// Shared store for "confirmed as correct" clicks, so the work PC and the Mac see the same
// confirmations and the maintainer can pull them into the rule golden set for review.
// Backed by the QA_FEEDBACK KV namespace; without that binding the endpoint reports
// { enabled: false } and the app keeps confirmations in the browser only.
// Only the short texts the user confirmed are stored, never whole documents.
import { enforceRequestAuth, jsonResponse } from "../_shared/auth";
import { readJsonBodyWithLimit } from "../_shared/limits";

type KvNamespace = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (options: { prefix?: string; cursor?: string; limit?: number }) => Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }>;
};

const PREFIX = "confirm:";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 4000;
const MAX_ENTRIES = 2000;
const KEY_PATTERN = /^[A-Za-z]+\|[^|]{0,60}\|[0-9]+-[0-9a-z]+(?:\|[0-9]+-[0-9a-z]+)?$/;

const getStore = (env: Record<string, unknown>) => (env.QA_FEEDBACK as KvNamespace | undefined) || null;

const clip = (value: unknown, max = MAX_TEXT_LENGTH) => String(value ?? "").slice(0, max);

const sanitizeEntry = (raw: any, userEmail: string) => {
  const key = String(raw?.key || "").trim();
  if (!KEY_PATTERN.test(key)) return null;
  const translatedText = clip(raw.translatedText);
  if (!translatedText.trim()) return null;
  return {
    key,
    type: clip(raw.type, 40),
    targetLang: clip(raw.targetLang, 40),
    sourceText: clip(raw.sourceText),
    translatedText,
    sourceHash: raw.sourceHash ? clip(raw.sourceHash, 40) : undefined,
    createdAt: clip(raw.createdAt, 40) || new Date().toISOString(),
    appVersion: clip(raw.appVersion, 20) || undefined,
    documentKind: clip(raw.documentKind, 20) || undefined,
    locationLabel: clip(raw.locationLabel, 200) || undefined,
    reviewStatus: raw.reviewStatus === "reviewed" ? "reviewed" : "pending",
    confirmedBy: userEmail || undefined
  };
};

const disabled = () => jsonResponse({ enabled: false, entries: [] });

export const onRequestGet = async (context: any) => {
  const env = (context.env || {}) as Record<string, unknown>;
  const authResult = await enforceRequestAuth(context.request, env);
  if (!authResult.ok) return authResult.response!;
  const store = getStore(env);
  if (!store) return disabled();

  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list({ prefix: PREFIX, cursor, limit: 1000 });
    names.push(...page.keys.map((item) => item.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && names.length < MAX_ENTRIES);

  const values = await Promise.all(names.slice(0, MAX_ENTRIES).map((name) => store.get(name)));
  const entries = values
    .map((value) => {
      try {
        return value ? JSON.parse(value) : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return jsonResponse({ enabled: true, entries });
};

export const onRequestPost = async (context: any) => {
  const env = (context.env || {}) as Record<string, unknown>;
  const authResult = await enforceRequestAuth(context.request, env);
  if (!authResult.ok) return authResult.response!;
  const store = getStore(env);
  if (!store) return disabled();

  const body = await readJsonBodyWithLimit(context.request, MAX_BODY_BYTES);
  if (body.response) return body.response;
  const entry = sanitizeEntry(body.data?.entry, authResult.auth.userEmail);
  if (!entry) return jsonResponse({ error: "Invalid confirmation entry." }, 400);
  await store.put(`${PREFIX}${entry.key}`, JSON.stringify(entry));
  return jsonResponse({ enabled: true, ok: true });
};

export const onRequestDelete = async (context: any) => {
  const env = (context.env || {}) as Record<string, unknown>;
  const authResult = await enforceRequestAuth(context.request, env);
  if (!authResult.ok) return authResult.response!;
  const store = getStore(env);
  if (!store) return disabled();

  const key = new URL(context.request.url).searchParams.get("key") || "";
  if (!KEY_PATTERN.test(key)) return jsonResponse({ error: "Invalid key." }, 400);
  await store.delete(`${PREFIX}${key}`);
  return jsonResponse({ enabled: true, ok: true });
};
