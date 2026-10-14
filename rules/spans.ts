// Span categories: the shared answer to "may this piece of text stay as it is?".
//
// Quality checks used to look at a whole translated string and guess whether leftover Latin or
// Chinese text was an error. Text that policy allows to stay verbatim (legal entity names,
// address blocks, contact details, codes, units, fixed regulatory expressions) was therefore
// flagged again and again. Instead, every checker first annotates these kept spans and only
// judges what is left: the PROSE that must be translated.
//
// Categories:
//   LOCKED  codes, units, numbers, standards, URLs, e-mail, phone numbers; must stay verbatim
//   ENTITY  protected terms (do-not-translate list, user protected terms) and legal entity names
//   PROPER  address blocks and other proper names; may stay verbatim or be transliterated
// Everything outside a span is PROSE.
//
// Policy (2026-10-14): manufacturer / EU representative address blocks may stay in the original
// language; they may also be translated. Checks only judge the prose around them.

import { getProtectedTermPatterns } from '../utils/translationTokens';
import { MEDICAL_CODE_LIST } from './patterns';

export type KeptSpanCategory = 'LOCKED' | 'ENTITY' | 'PROPER';

export interface KeptSpan {
  start: number;
  end: number;
  text: string;
  category: KeptSpanCategory;
  rule: string;
}

const CONTACT_LABEL =
  '(?:Tel|Tél|Teléfono|Telefone|Telefono|Telefon|Phone|Fax|Mob(?:ile)?|E-?mail|Courriel|Correo|Website|Web(?:site)?|Site web|Sitio web|Тел|Факс|电话|傳真|传真|邮箱|網址|网址)';
const CONTACT_LABEL_PREFIX_REGEX = new RegExp(`${CONTACT_LABEL}\\.?\\s*[:：]?\\s*$`, 'i');

const URL_SPAN_REGEX = /\b(?:https?:\/\/|www\.)[^\s"'<>，。；、]+/gi;
const EMAIL_SPAN_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_SPAN_REGEX = /\+\s?\d{1,3}(?:[\s-]?\(?\d{1,5}\)?)(?:[\s-]?\d{2,8}){1,4}/g;
const LABELLED_PHONE_SPAN_REGEX = new RegExp(`${CONTACT_LABEL}\\.?\\s*[:：]?\\s*\\(?\\d[\\d\\s()\\-]{6,}\\d`, 'gi');
const STANDARD_SPAN_REGEX =
  /\b(?:EN|IEC|ISO|GB\/T|GB|YY\/T|YY|IEEE|UL|CLSI|ASTM|CISPR)\s?\d[\d.\-]*(?:\s?[:：]\s?\d{4})?(?:\s?\+\s?A\d+(?:\s?[:：]\s?\d{4})?)*/g;
const NUMERIC_UNIT_SPAN_REGEX =
  /[≤≥<>±~]?\s?\d+(?:[.,]\d+)?(?:\s?[-~–]\s?\d+(?:[.,]\d+)?)?\s?(?:dBA|dB|kV|mV|V|kHz|Hz|VA|W|mA|A|°C|℃|mL|ml|μL|µL|uL|fL|pg|g\/dL|g\/L|mmol\/L|μmol\/L|mg|kg|g|mm|cm|min|s|h|L)(?![A-Za-z])/g;

const MEDICAL_CODE_SPAN_REGEX = new RegExp(
  `(?<![A-Za-z0-9])(?:${MEDICAL_CODE_LIST})[#%]?(?:\\/(?:${MEDICAL_CODE_LIST})[#%]?)*(?![A-Za-z0-9])`,
  'g'
);

const LEGAL_SUFFIX =
  '(?:Co\\.\\s?,?\\s?Ltd\\.?|Co\\.,?\\s?Limited|Co\\.|Ltd\\.?|Limited|Inc\\.?|LLC|L\\.L\\.C\\.|GmbH(?:\\s?&\\s?Co\\.\\s?KG)?|AG|KG|S\\.L\\.U?\\.?|S\\.A\\.U?\\.?|S\\.A\\.S\\.?|SAS|SARL|S\\.r\\.l\\.|Srl|S\\.p\\.A\\.|SpA|B\\.V\\.|N\\.V\\.|Sp\\.\\s?z\\s?o\\.\\s?o\\.|Pty\\.?\\s?Ltd\\.?|A\\.Ş\\.|Ltd\\.\\s?Şti\\.|Corporation|Corp\\.|Company|Group)';
const LATIN_COMPANY_SPAN_REGEX = new RegExp(
  `(?<![A-Za-z])(?:[A-Z][A-Za-z0-9&'’\\-]*\\.?\\s+){1,8}${LEGAL_SUFFIX}(?![A-Za-z])`,
  'g'
);
const CJK_COMPANY_SPAN_REGEX = /[一-鿿（）()]{2,40}?(?:股份有限公司|有限责任公司|有限公司|集团)/g;

// Address block: a run of comma-separated parts in which several parts carry address signals.
const ADDRESS_KEYWORD_REGEX =
  /\b(?:Room|Rm\.?|Suite|Unit|Floor|Fl\.|Building|Bldg\.?|Block|Tower|Street|St\.|Road|Rd\.|Avenue|Ave\.?|Boulevard|Blvd\.?|Lane|Drive|District|County|City|Province|Town|Village|Industrial|Park|Zone|Plaza|Square|Calle|Avenida|Rua|Rue|Straße|Strasse|Str\.|Via|Viale|Piazza|Plein|ulica|ul\.|Cad\.|Sok\.|Mah\.)\b|(?:straße|strasse|laan|weg|gracht|graben|plein|plaats)\b|\bNo\.\s?\d/i;
const ADDRESS_COUNTRY_REGEX =
  /\b(?:P\.\s?R\.\s?(?:of\s)?China|PR\s?China|China|Spain|Germany|Netherlands|The Netherlands|Italy|France|Poland|Romania|Turkey|Türkiye|Russia|Portugal|Brazil|USA|U\.S\.A\.|United States|United Kingdom|UK|Belgium|Switzerland|Austria|Ireland|Czech Republic|Hungary|Greece)\b\.?/;
const POSTCODE_REGEX = /\b\d{4,6}(?:\s?[A-Z]{2})?\b/;

const isAddressPart = (part: string) => ADDRESS_KEYWORD_REGEX.test(part) || ADDRESS_COUNTRY_REGEX.test(part);
const isAddressSupportPart = (part: string) =>
  isAddressPart(part) || (POSTCODE_REGEX.test(part) && /[A-Za-z]/.test(part)) || /^\s*(?:[A-Z][A-Za-z'’\-]+\s?){1,4}\.?\s*$/.test(part);

const findAddressSpans = (text: string): KeptSpan[] => {
  const parts: Array<{ start: number; end: number; text: string }> = [];
  const splitter = /[^,，;；]+/g;
  for (const match of text.matchAll(splitter)) {
    parts.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, text: match[0] });
  }
  const spans: KeptSpan[] = [];
  let index = 0;
  while (index < parts.length) {
    if (!isAddressPart(parts[index].text)) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < parts.length && isAddressSupportPart(parts[end + 1].text)) end += 1;
    const run = parts.slice(index, end + 1);
    const strong = run.filter((part) => isAddressPart(part.text)).length;
    if (run.length >= 3 && strong >= 2) {
      const first = run[0];
      // A leading label ("Address: ", "Адрес: ") stays prose so it is still checked.
      const labelMatch = first.text.match(/^(.*[:：]\s*)/);
      const start = first.start + (labelMatch ? labelMatch[1].length : 0);
      const last = run[run.length - 1];
      spans.push({ start, end: last.end, text: text.slice(start, last.end), category: 'PROPER', rule: 'address-block' });
    }
    index = end + 1;
  }
  return spans;
};

const collectRegexSpans = (text: string, regex: RegExp, category: KeptSpanCategory, rule: string) => {
  const spans: KeptSpan[] = [];
  regex.lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    const raw = match[0];
    const trimmed = raw.replace(/[\s.,;:]+$/, (tail) => (/^\.$/.test(tail) && /[A-Z]\.$|Ltd\.$|Co\.$|Inc\.$|Corp\.$/.test(raw) ? tail : ''));
    const leading = trimmed.length - trimmed.trimStart().length;
    const start = (match.index ?? 0) + leading;
    const value = trimmed.trim();
    if (!value) continue;
    spans.push({ start, end: start + value.length, text: value, category, rule });
  }
  return spans;
};

const extendContactLabel = (text: string, span: KeptSpan): KeptSpan => {
  const before = text.slice(Math.max(0, span.start - 24), span.start);
  const match = before.match(CONTACT_LABEL_PREFIX_REGEX);
  if (!match) return span;
  const start = span.start - match[0].length;
  return { ...span, start, text: text.slice(start, span.end) };
};

const mergeSpans = (spans: KeptSpan[]) => {
  const sorted = spans
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: KeptSpan[] = [];
  sorted.forEach((span) => {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      if (span.end > last.end) {
        last.end = span.end;
        last.text = '';
      }
      return;
    }
    merged.push({ ...span });
  });
  return merged;
};

const ENTITY_STOPWORDS = new Set(['the', 'this', 'that', 'our', 'your', 'their', 'its', 'a', 'an', 'each', 'every', 'any', 'such']);
const isPlausibleLegalEntity = (span: KeptSpan) => {
  const words = span.text.split(/\s+/).filter(Boolean);
  const nameWords = words.slice(0, -1).filter((word) => !ENTITY_STOPWORDS.has(word.toLowerCase().replace(/[^a-z]/g, '')));
  return nameWords.length > 0;
};

export const annotateKeptSpans = (text: string): KeptSpan[] => {
  const value = String(text || '');
  if (!value.trim()) return [];
  const contact = [
    ...collectRegexSpans(value, URL_SPAN_REGEX, 'LOCKED', 'url'),
    ...collectRegexSpans(value, EMAIL_SPAN_REGEX, 'LOCKED', 'email'),
    ...collectRegexSpans(value, PHONE_SPAN_REGEX, 'LOCKED', 'phone'),
    ...collectRegexSpans(value, LABELLED_PHONE_SPAN_REGEX, 'LOCKED', 'phone')
  ].map((span) => extendContactLabel(value, span));
  const protectedSpans = getProtectedTermPatterns().flatMap((pattern) =>
    collectRegexSpans(value, new RegExp(pattern.source, pattern.flags), 'ENTITY', 'protected-term')
  );
  const spans = mergeSpans([
    ...contact,
    ...protectedSpans,
    ...collectRegexSpans(value, STANDARD_SPAN_REGEX, 'LOCKED', 'standard'),
    ...collectRegexSpans(value, NUMERIC_UNIT_SPAN_REGEX, 'LOCKED', 'numeric-unit'),
    ...collectRegexSpans(value, MEDICAL_CODE_SPAN_REGEX, 'LOCKED', 'medical-code'),
    ...collectRegexSpans(value, LATIN_COMPANY_SPAN_REGEX, 'ENTITY', 'legal-entity').filter(isPlausibleLegalEntity),
    ...collectRegexSpans(value, CJK_COMPANY_SPAN_REGEX, 'ENTITY', 'legal-entity'),
    ...findAddressSpans(value)
  ]);
  return spans.map((span) => ({ ...span, text: value.slice(span.start, span.end) }));
};

/** Replaces kept spans so that only PROSE remains for language checks. */
export const maskKeptSpans = (text: string, replacement = ' ', spans = annotateKeptSpans(text)) => {
  const value = String(text || '');
  if (!spans.length) return value;
  let output = '';
  let cursor = 0;
  spans.forEach((span) => {
    output += value.slice(cursor, span.start) + replacement;
    cursor = span.end;
  });
  output += value.slice(cursor);
  return output;
};

/** Text left for language-residue checks: kept spans removed, whitespace collapsed. */
export const getProseForLanguageCheck = (text: string) =>
  maskKeptSpans(text, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[\s:：,，;；.\-–—]+|[\s:：,，;；\-–—]+$/g, '')
    .trim();

/** Text for spacing/format checks: kept spans become a neutral symbol so surrounding spacing stays intact. */
export const getProseForFormatCheck = (text: string) => maskKeptSpans(text, '◆');
