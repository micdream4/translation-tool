// Shared store for "confirmed as correct" clicks, so the work PC and the Mac see the same
// confirmations and the maintainer can pull them into the rule golden set for review.
// Backed by the QA_FEEDBACK KV namespace; without that binding the endpoint reports
// { enabled: false } and the app keeps confirmations in the browser only.
// Only the short texts the user confirmed are stored, never whole documents.
//
// The server recomputes each key from the texts, so one confirmation can only cover its own
// source sentence. Browsers can only add "pending" entries; marking them reviewed is done by the
// maintainer script (scripts/qaFeedback.mjs, through wrangler). An entry can be replaced or
// deleted only by the person who confirmed it. Listing is paged so a large store stays under the
// per-request subrequest limit.
import { buildQualityExceptionKey } from "../../quality/exceptions";
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
const PAGE_SIZE = 200;
const KEY_PATTERN = /^[A-Za-z]+\|[^|]{0,60}\|[0-9]+-[0-9a-z]+(?:\|[0-9]+-[0-9a-z]+)?$/;

const getStore = (env: Record<string, unknown>) => (env.QA_FEEDBACK as KvNamespace | undefined) || null;

const clip = (value: unknown, max = MAX_TEXT_LENGTH) => String(value ?? "").slice(0, max);

const sanitizeEntry = (raw: any, userEmail: string) => {
  const key = String(raw?.key || "").trim();
  if (!KEY_PATTERN.test(key)) return null;
  const type = clip(raw.type, 40);
  const targetLang = clip(raw.targetLang, 40);
  const sourceText = clip(raw.sourceText);
  const translatedText = clip(raw.translatedText);
  // A confirmation without its source sentence would silence the same translation everywhere.
  if (!translatedText.trim() || !sourceText.trim()) return null;
  if (key !== buildQualityExceptionKey(type, targetLang, translatedText, sourceText)) return null;
  return {
    key,
    type,
    targetLang,
    sourceText,
    translatedText,
    sourceHash: key.split("|")[3],
    createdAt: clip(raw.createdAt, 40) || new Date().toISOString(),
    appVersion: clip(raw.appVersion, 20) || undefined,
    documentKind: clip(raw.documentKind, 20) || undefined,
    locationLabel: clip(raw.locationLabel, 200) || undefined,
    reviewStatus: "pending" as const,
    confirmedBy: userEmail || undefined
  };
};

const readEntry = async (store: KvNamespace, key: string) => {
  try {
    const value = await store.get(`${PREFIX}${key}`);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

const isOwnedByOther = (entry: any, userEmail: string) =>
  Boolean(entry?.confirmedBy && userEmail && entry.confirmedBy !== userEmail);

const disabled = () => jsonResponse({ enabled: false, entries: [] });

export const onRequestGet = async (context: any) => {
  const env = (context.env || {}) as Record<string, unknown>;
  const authResult = await enforceRequestAuth(context.request, env);
  if (!authResult.ok) return authResult.response!;
  const store = getStore(env);
  if (!store) return disabled();

  const cursor = new URL(context.request.url).searchParams.get("cursor") || undefined;
  const page = await store.list({ prefix: PREFIX, cursor, limit: PAGE_SIZE });
  const values = await Promise.all(page.keys.map((item) => store.get(item.name)));
  const entries = values
    .map((value) => {
      try {
        return value ? JSON.parse(value) : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return jsonResponse({
    enabled: true,
    entries,
    complete: page.list_complete,
    ...(page.list_complete ? {} : { cursor: page.cursor })
  });
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
  const existing = await readEntry(store, entry.key);
  if (isOwnedByOther(existing, authResult.auth.userEmail)) {
    return jsonResponse({ error: "This confirmation belongs to another user." }, 403);
  }
  // Already stored (and possibly reviewed): keep it as it is.
  if (existing) return jsonResponse({ enabled: true, ok: true });
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
  if (isOwnedByOther(await readEntry(store, key), authResult.auth.userEmail)) {
    return jsonResponse({ error: "This confirmation belongs to another user." }, 403);
  }
  await store.delete(`${PREFIX}${key}`);
  return jsonResponse({ enabled: true, ok: true });
};
