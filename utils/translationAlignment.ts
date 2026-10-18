import type { POCTRecord } from '../types';

export const TRANSLATION_RECORD_ID_KEY = '__poct_record_id';
export const TRANSLATION_RECORD_PAYLOAD_KEY = 'payload';

export type TranslationEnvelope = {
  [TRANSLATION_RECORD_ID_KEY]: number;
  [TRANSLATION_RECORD_PAYLOAD_KEY]: POCTRecord;
};

const isRecord = (value: unknown): value is POCTRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const wrapTranslationRecords = (records: POCTRecord[]): TranslationEnvelope[] =>
  records.map((payload, index) => ({
    [TRANSLATION_RECORD_ID_KEY]: index,
    [TRANSLATION_RECORD_PAYLOAD_KEY]: payload
  }));

export const isTranslationEnvelopeBatch = (records: POCTRecord[]) =>
  records.length > 0 &&
  records.every(
    (record) =>
      Number.isInteger(record?.[TRANSLATION_RECORD_ID_KEY]) &&
      isRecord(record?.[TRANSLATION_RECORD_PAYLOAD_KEY])
  );

const alignmentError = (message: string) =>
  new Error(`Translation alignment mismatch: ${message}`);

export const alignTranslationEnvelopes = (
  expected: POCTRecord[],
  translated: POCTRecord[]
): TranslationEnvelope[] => {
  const expectedIds = expected.map((record) => record?.[TRANSLATION_RECORD_ID_KEY]);
  if (!expectedIds.every(Number.isInteger)) {
    throw alignmentError('source envelope is missing a numeric record id.');
  }

  const translatedById = new Map<number, TranslationEnvelope>();
  translated.forEach((record) => {
    const id = record?.[TRANSLATION_RECORD_ID_KEY];
    const payload = record?.[TRANSLATION_RECORD_PAYLOAD_KEY];
    if (!Number.isInteger(id) || !isRecord(payload)) {
      throw alignmentError('model output is missing a record id or payload object.');
    }
    if (translatedById.has(id)) {
      throw alignmentError(`duplicate record id ${id}.`);
    }
    translatedById.set(id, record as TranslationEnvelope);
  });

  if (translatedById.size !== expectedIds.length) {
    throw alignmentError(`received ${translatedById.size} ids, expected ${expectedIds.length}.`);
  }

  return expectedIds.map((id) => {
    const envelope = translatedById.get(Number(id));
    if (!envelope) {
      throw alignmentError(`missing record id ${id}.`);
    }
    return envelope;
  });
};

/**
 * Splits a model reply into the envelopes that came back (by record id) and the source envelopes
 * still missing, so a caller can keep the good rows and ask again only for the dropped ones.
 * A reply that is malformed (no id or payload, duplicate ids) still throws.
 */
export const partitionTranslationEnvelopes = (expected: POCTRecord[], translated: POCTRecord[]) => {
  const expectedIds = new Set(expected.map((record) => record?.[TRANSLATION_RECORD_ID_KEY]));
  const byId = new Map<number, TranslationEnvelope>();
  (Array.isArray(translated) ? translated : []).forEach((record) => {
    const id = record?.[TRANSLATION_RECORD_ID_KEY];
    const payload = record?.[TRANSLATION_RECORD_PAYLOAD_KEY];
    if (!Number.isInteger(id) || !isRecord(payload)) {
      throw alignmentError('model output is missing a record id or payload object.');
    }
    if (byId.has(id)) throw alignmentError(`duplicate record id ${id}.`);
    if (expectedIds.has(id)) byId.set(id, record as TranslationEnvelope);
  });
  const missing = expected.filter((record) => !byId.has(record[TRANSLATION_RECORD_ID_KEY]));
  return { byId, missing };
};

export const unwrapTranslationEnvelopes = (records: POCTRecord[]): POCTRecord[] =>
  records.map((record) => {
    const payload = record?.[TRANSLATION_RECORD_PAYLOAD_KEY];
    if (!isRecord(payload)) {
      throw alignmentError('aligned record is missing its payload object.');
    }
    return payload;
  });

// Keys that describe a record rather than hold text to translate.
const NON_CONTENT_KEYS = new Set(['id', 'contextBefore', 'contextAfter']);

/**
 * Whether a record (or an envelope's payload) has any text for the model. Empty rows are not
 * sent: models tend to drop them from the reply ("returned 4 of 5 records"), which used to fail
 * or split the whole batch.
 */
export const hasTextToTranslate = (record: POCTRecord) => {
  const payload = isRecord(record?.[TRANSLATION_RECORD_PAYLOAD_KEY]) && Number.isInteger(record?.[TRANSLATION_RECORD_ID_KEY])
    ? record[TRANSLATION_RECORD_PAYLOAD_KEY]
    : record;
  return Object.entries(payload || {}).some(
    ([key, value]) => !NON_CONTENT_KEYS.has(key) && typeof value === 'string' && value.trim() !== ''
  );
};

/**
 * Puts the records that were not sent (nothing to translate) back in their places, unchanged.
 * `translated` is the reply for the records that were sent, in the same order.
 */
export const mergeUntranslatableRecords = (all: POCTRecord[], translated: POCTRecord[]) => {
  let next = 0;
  return all.map((record) => (hasTextToTranslate(record) ? translated[next++] : record));
};

const CJK_CHAR = /[\u3400-\u9fff\uf900-\ufaff]/;
// Simplified -> Traditional conversion maps character for character: same length, and the
// characters that differ are all CJK.
const isConvertedKey = (sourceKey: string, replyKey: string) =>
  sourceKey.length === replyKey.length &&
  [...sourceKey].every((char, index) => char === replyKey[index] || (CJK_CHAR.test(char) && CJK_CHAR.test(replyKey[index])));

/**
 * Models sometimes translate the keys too (Chinese column headers converted to Traditional
 * Chinese for zh-TW), so the cells no longer match their columns. Each missing source key is
 * matched, in order, to a renamed reply key that is a character-for-character conversion of it.
 */
export const restoreRecordKeys = (source: POCTRecord, translated: POCTRecord): POCTRecord => {
  if (!isRecord(source) || !isRecord(translated)) return translated;
  const missing = Object.keys(source).filter((key) => !(key in translated));
  const extra = Object.keys(translated).filter((key) => !(key in source));
  if (!missing.length || !extra.length) return translated;
  const renamed = new Map<string, string>();
  missing.forEach((sourceKey) => {
    const replyKey = extra.find((key) => !renamed.has(key) && isConvertedKey(sourceKey, key));
    if (replyKey) renamed.set(replyKey, sourceKey);
  });
  if (!renamed.size) return translated;
  return Object.fromEntries(Object.entries(translated).map(([key, value]) => [renamed.get(key) ?? key, value]));
};

/** restoreRecordKeys for a whole reply: plain records by position, envelopes by record id. */
export const restoreBatchKeys = (sent: POCTRecord[], reply: POCTRecord[]): POCTRecord[] => {
  if (!Array.isArray(reply)) return reply;
  if (!isTranslationEnvelopeBatch(sent)) return reply.map((record, index) => restoreRecordKeys(sent[index], record));
  const sentById = new Map(sent.map((record) => [record[TRANSLATION_RECORD_ID_KEY], record[TRANSLATION_RECORD_PAYLOAD_KEY]]));
  return reply.map((record) => {
    const source = sentById.get(record?.[TRANSLATION_RECORD_ID_KEY]);
    return source && isRecord(record?.[TRANSLATION_RECORD_PAYLOAD_KEY])
      ? { ...record, [TRANSLATION_RECORD_PAYLOAD_KEY]: restoreRecordKeys(source, record[TRANSLATION_RECORD_PAYLOAD_KEY]) }
      : record;
  });
};
