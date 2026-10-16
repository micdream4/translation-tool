// Retention policy: which text may stay in its original form.
// One source of truth rendered into the translation prompt and the AI review prompts, and
// mirrored by the span detectors in rules/spans.ts that the rule-based quality checks use.
// Change the policy here, then run `npm run test:rule-golden` to see its effect.

export interface RetentionRule {
  id: string;
  /** Instruction for the translating model. */
  translate: string;
  /** Instruction for an AI reviewer: what must NOT be reported as untranslated. */
  review: string;
}

export const RETENTION_POLICY: RetentionRule[] = [
  {
    id: 'locked',
    translate:
      'Keep verbatim: product models, IDs, codes, measurement units, numbers and ranges, standard numbers (EN/IEC/ISO/GB/YY), URLs, e-mail addresses, phone numbers and placeholder tokens.',
    review: 'Product models, IDs, codes, units, numbers, standard numbers, URLs, e-mail addresses and phone numbers kept as in the source.'
  },
  {
    id: 'legal-entity',
    translate:
      'Keep legal entity names (company names ending in Co., Ltd., S.L., GmbH, B.V., Inc., Corporation, 有限公司, etc.) exactly as in the source unless an official translated name is given in the terminology list.',
    review: 'Company / legal entity names kept as in the source (or written with their official name).'
  },
  {
    id: 'address-block',
    translate:
      'Address blocks (manufacturer, EU representative, distributor, service addresses: room, building, street, district, city, postcode, country) may stay exactly as in the source. If you translate an address block, translate it consistently as a whole and keep street and place names transliterated or unchanged.',
    review: 'Address blocks (manufacturer, EU representative, service addresses) kept in the original language, fully or partly; this is allowed.'
  },
  {
    id: 'fixed-expression',
    translate:
      'Keep fixed regulatory expressions and symbol texts unchanged: "Rx only", "EC REP", "IVD", "REF", "LOT", "CE", and every term in the do-not-translate list.',
    review: 'Fixed regulatory expressions and symbol texts such as "Rx only", "EC REP", "IVD", "REF", "LOT", "CE".'
  },
  {
    id: 'scientific-name',
    translate:
      'Keep Latin scientific names of organisms in Latin, as medical texts do in every language (e.g. "Bordetella bronchiseptica", "Staphylococcus aureus", "E. coli"); translate the words around them.',
    review: 'Latin scientific names of organisms (e.g. "Bordetella bronchiseptica", "E. coli") kept in Latin.'
  },
  {
    id: 'prose',
    translate:
      'Everything else (sentences, headings, table text, labels, UI text, and the descriptive words around kept items, e.g. "Manufacturer:", "Address:") must be fully translated.',
    review: 'Everything else must be translated; untranslated sentences, labels or headings are real problems.'
  }
];

export const renderRetentionPolicyForPrompt = () =>
  RETENTION_POLICY.map((rule) => `- ${rule.translate}`).join('\n');

export const renderRetentionPolicyForReview = () =>
  [
    '- Do NOT report the following as untranslated or as a problem; the retention policy allows them to stay in the original:',
    ...RETENTION_POLICY.filter((rule) => rule.id !== 'prose').map((rule) => `  * ${rule.review}`),
    `- ${RETENTION_POLICY.find((rule) => rule.id === 'prose')!.review}`
  ].join('\n');
