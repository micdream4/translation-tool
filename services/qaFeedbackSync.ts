// Syncs "confirmed as correct" clicks with the shared store (/api/qa-feedback, Cloudflare KV),
// so confirmations made on one computer apply on the other and can be pulled into the rule
// golden set for review. Every call fails quietly: without the store, confirmations stay local.
import {
  markQualityExceptionSynced,
  mergeRemoteQualityExceptions,
  type QualityException
} from '../quality/exceptions';

const ENDPOINT = '/api/qa-feedback';

const isProxyMode = () => {
  const env = ((import.meta as any).env || {}) as Record<string, string | boolean | undefined>;
  const mode = String(env.VITE_TRANSLATION_MODE || '').toLowerCase().trim();
  if (mode === 'proxy') return true;
  if (mode === 'direct') return false;
  return !env.DEV;
};

const request = async (init: RequestInit & { query?: string } = {}) => {
  if (!isProxyMode() || typeof fetch === 'undefined') return null;
  try {
    const response = await fetch(`${ENDPOINT}${init.query || ''}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...init
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.enabled ? payload : null;
  } catch {
    return null;
  }
};

const toPayload = ({ synced: _synced, ...entry }: QualityException) => entry;

export const pushQualityException = async (entry: QualityException) => {
  const result = await request({ method: 'POST', body: JSON.stringify({ entry: toPayload(entry) }) });
  if (result?.ok) markQualityExceptionSynced(entry.key);
  return Boolean(result?.ok);
};

export const deleteRemoteQualityException = async (key: string) =>
  Boolean((await request({ method: 'DELETE', query: `?key=${encodeURIComponent(key)}` }))?.ok);

const MAX_PAGES = 50;

/** Pull shared confirmations, then push local ones the store does not have yet. Returns whether the store is on. */
export const syncQualityExceptions = async () => {
  const entries: QualityException[] = [];
  let cursor = '';
  let complete = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await request({ method: 'GET', query: cursor ? `?cursor=${encodeURIComponent(cursor)}` : '' });
    if (!result || !Array.isArray(result.entries)) {
      if (page === 0) return false;
      break;
    }
    entries.push(...(result.entries as QualityException[]));
    // Older servers return everything at once without paging fields.
    if (result.complete !== false || !result.cursor) {
      complete = true;
      break;
    }
    cursor = String(result.cursor);
  }
  const unsynced = mergeRemoteQualityExceptions(entries, { complete });
  await Promise.all(unsynced.map((entry) => pushQualityException(entry)));
  return true;
};
