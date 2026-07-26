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

export const unwrapTranslationEnvelopes = (records: POCTRecord[]): POCTRecord[] =>
  records.map((record) => {
    const payload = record?.[TRANSLATION_RECORD_PAYLOAD_KEY];
    if (!isRecord(payload)) {
      throw alignmentError('aligned record is missing its payload object.');
    }
    return payload;
  });
