import type { TargetLanguage } from '../types';

export type TargetLanguageProfile = {
  target: string;
  script: 'latin' | 'cyrillic' | 'cjk';
  preferredLocale?: string;
  disallowedLatinResidueWords?: string[];
  englishResidueWords?: string[];
  englishResiduePhrases?: string[];
  diacriticRiskWords?: Array<{ plain: string; preferred: string }>;
  commonFunctionWords?: string[];
  distinctiveCharacters?: RegExp;
  notes: string[];
};

const normalizeLatinToken = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');

export const RUSSIAN_DISALLOWED_LATIN_RESIDUE_WORDS = [
  'analysis',
  'blood',
  'building',
  'cell',
  'city',
  'control',
  'count',
  'device',
  'district',
  'establish',
  'feces',
  'home',
  'hour',
  'list',
  'lists',
  'maintenance',
  'operation',
  'order',
  'orders',
  'page',
  'preparation',
  'province',
  'reference',
  'references',
  'report',
  'reports',
  'result',
  'results',
  'ref',
  'sample',
  'service',
  'services',
  'setting',
  'settings',
  'street',
  'successful',
  'support',
  'uncertain',
  'white',
  'year'
];

const RUSSIAN_DISALLOWED_LATIN_RESIDUE_SET = new Set(
  RUSSIAN_DISALLOWED_LATIN_RESIDUE_WORDS.map(normalizeLatinToken)
);

export const FRENCH_ENGLISH_RESIDUE_WORDS = [
  'blue',
  'button',
  'consumables',
  'lifted',
  'quickly',
  'remove',
  'removed',
  'squeeze',
  'testing'
];

export const FRENCH_ENGLISH_RESIDUE_PHRASES = [
  'quickly squeeze',
  'blue button',
  'the blue button is lifted'
];

export const FRENCH_DIACRITIC_RISK_WORDS = [
  { plain: 'hemoglobine', preferred: 'hémoglobine' },
  { plain: 'anemie', preferred: 'anémie' },
  { plain: 'hemolytique', preferred: 'hémolytique' },
  { plain: 'hemolyse', preferred: 'hémolyse' },
  { plain: 'reticulocytes', preferred: 'réticulocytes' },
  { plain: 'spherocytes', preferred: 'sphérocytes' },
  { plain: 'defaut', preferred: 'défaut' },
  { plain: 'deficit', preferred: 'déficit' },
  { plain: 'medicaments', preferred: 'médicaments' },
  { plain: 'declencher', preferred: 'déclencher' },
  { plain: 'presence', preferred: 'présence' },
  { plain: 'reaction', preferred: 'réaction' },
  { plain: 'suggerer', preferred: 'suggérer' },
  { plain: 'eleve', preferred: 'élevé' },
  { plain: 'elevee', preferred: 'élevée' },
  { plain: 'elevation', preferred: 'élévation' },
  { plain: 'synthese', preferred: 'synthèse' },
  { plain: 'reserves', preferred: 'réserves' },
  { plain: 'suggere', preferred: 'suggère' },
  { plain: 'leger', preferred: 'léger' },
  { plain: 'legere', preferred: 'légère' },
  { plain: 'modere', preferred: 'modéré' }
];

const FRENCH_DIACRITIC_RISK_MAP = new Map(
  FRENCH_DIACRITIC_RISK_WORDS.map((item) => [normalizeLatinToken(item.plain), item])
);

export const isRussianTarget = (targetLang?: TargetLanguage) =>
  String(targetLang || '').toLowerCase().includes('russian');

export const isFrenchTarget = (targetLang?: TargetLanguage) =>
  String(targetLang || '').toLowerCase().includes('french');

export const isRussianDisallowedLatinResidue = (token: string) =>
  RUSSIAN_DISALLOWED_LATIN_RESIDUE_SET.has(normalizeLatinToken(token));

export const getRussianResidueProfile = () => ({
  target: 'Russian' as const,
  disallowedLatinResidueWords: [...RUSSIAN_DISALLOWED_LATIN_RESIDUE_WORDS]
});

export const TARGET_LANGUAGE_PROFILES: Record<string, TargetLanguageProfile> = {
  russian: {
    target: 'Russian',
    script: 'cyrillic',
    disallowedLatinResidueWords: [...RUSSIAN_DISALLOWED_LATIN_RESIDUE_WORDS],
    notes: [
      'Flag ordinary English UI/manual words mixed into Cyrillic text.',
      'Allow protected brands, medical abbreviations, units, model names, and IDs.'
    ]
  },
  french: {
    target: 'French',
    script: 'latin',
    englishResidueWords: [...FRENCH_ENGLISH_RESIDUE_WORDS],
    englishResiduePhrases: [...FRENCH_ENGLISH_RESIDUE_PHRASES],
    diacriticRiskWords: [...FRENCH_DIACRITIC_RISK_WORDS],
    commonFunctionWords: ['le', 'la', 'les', 'des', 'une', 'avec', 'pour', 'dans', 'sur'],
    distinctiveCharacters: /[éèêëàâçîïôûùüÿœ]/i,
    notes: [
      'Use standard French orthography with accents for medical/common terms.',
      'Conserve numeric/unit forms such as 2-8°C when source uses compact medical formatting.',
      'Do not over-flag shared Latin medical abbreviations as English.'
    ]
  },
  spanish: {
    target: 'Spanish',
    script: 'latin',
    commonFunctionWords: ['el', 'la', 'los', 'las', 'del', 'para', 'con', 'sin', 'por'],
    distinctiveCharacters: /[ñáéíóúü¡¿]/i,
    notes: [
      'Prefer Spanish function words and punctuation while preserving medical codes and units.',
      'Do not treat shared Latin medical terms as English residue without a strong signal.'
    ]
  },
  portuguese: {
    target: 'Portuguese',
    script: 'latin',
    commonFunctionWords: ['o', 'a', 'os', 'as', 'de', 'em', 'com', 'para'],
    distinctiveCharacters: /[ãõçáéíóúàâêô]/i,
    notes: [
      'Preserve compact number/unit formatting.',
      'Use diacritics as a positive signal but not as a hard requirement.'
    ]
  },
  german: {
    target: 'German',
    script: 'latin',
    commonFunctionWords: ['der', 'die', 'das', 'und', 'mit', 'bei', 'für'],
    distinctiveCharacters: /[äöüß]/i,
    notes: [
      'Expect German noun capitalization and compound words.',
      'Preserve model numbers, IDs, and units exactly.'
    ]
  },
  italian: {
    target: 'Italian',
    script: 'latin',
    commonFunctionWords: ['il', 'la', 'le', 'di', 'con', 'per', 'una'],
    distinctiveCharacters: /[àèéìòù]/i,
    notes: [
      'Use Italian function-word signal conservatively because many medical terms are shared Latin.',
      'Preserve numeric and unit formatting.'
    ]
  },
  turkish: {
    target: 'Turkish',
    script: 'latin',
    commonFunctionWords: ['ve', 'ile', 'bu', 'bir', 'için'],
    distinctiveCharacters: /[çğıöşü]/i,
    notes: [
      'Treat Turkish-specific characters as positive signal.',
      'Preserve medical abbreviations and model identifiers.'
    ]
  },
  'traditional chinese (taiwan)': {
    target: 'Traditional Chinese (Taiwan)',
    script: 'cjk',
    preferredLocale: 'zh-TW',
    notes: [
      'Flag Simplified Chinese residue and mainland phrasing in Taiwan-targeted output.',
      'Preserve medical abbreviations, IDs, and units.'
    ]
  }
};

export const getTargetLanguageProfile = (targetLang?: TargetLanguage) => {
  const normalized = String(targetLang || '').toLowerCase();
  return Object.entries(TARGET_LANGUAGE_PROFILES).find(([key]) => normalized.includes(key))?.[1] || null;
};

export const isProfileEnglishResidueToken = (token: string, targetLang?: TargetLanguage) => {
  const profile = getTargetLanguageProfile(targetLang);
  if (!profile?.englishResidueWords?.length) return false;
  return new Set(profile.englishResidueWords.map(normalizeLatinToken)).has(normalizeLatinToken(token));
};

export const hasProfileEnglishResidue = (text: string, targetLang?: TargetLanguage) => {
  const profile = getTargetLanguageProfile(targetLang);
  if (!profile) return false;
  const normalizedText = normalizeLatinToken(text).replace(/[^a-z0-9]+/g, ' ');
  if (
    profile.englishResiduePhrases?.some((phrase) =>
      normalizedText.includes(normalizeLatinToken(phrase).replace(/[^a-z0-9]+/g, ' '))
    )
  ) {
    return true;
  }
  const tokens = text.match(/\b[A-Za-z][A-Za-z0-9'-]{1,}\b/g) || [];
  return tokens.some((token) => isProfileEnglishResidueToken(token, targetLang));
};

export const collectFrenchDiacriticRisks = (text: string, targetLang?: TargetLanguage) => {
  if (!isFrenchTarget(targetLang)) return [];
  const tokens = String(text || '').match(/\b[A-Za-zÀ-ÖØ-öø-ÿœŒ][A-Za-zÀ-ÖØ-öø-ÿœŒ'-]{2,}\b/g) || [];
  const risks: Array<{ token: string; preferred: string }> = [];
  tokens.forEach((token) => {
    if (/[À-ÖØ-öø-ÿœŒ]/.test(token)) return;
    const risk = FRENCH_DIACRITIC_RISK_MAP.get(normalizeLatinToken(token));
    if (!risk) return;
    risks.push({ token, preferred: risk.preferred });
  });
  return risks;
};

export const hasFrenchDiacriticRisk = (text: string, targetLang?: TargetLanguage) =>
  collectFrenchDiacriticRisks(text, targetLang).length > 0;
