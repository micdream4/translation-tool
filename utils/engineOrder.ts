// Order in which "auto" tries the translation engines. One parser for the browser (VITE_PROXY_ENGINES,
// /api/me) and the Pages Functions (TRANSLATION_ENGINE_ORDER), so both sides agree on which engine
// goes first. Engines missing from the configured list keep their default position after it.

export type OrderedTranslationEngine = 'cloudflare-ai' | 'deepseek' | 'gemini';

export const DEFAULT_ENGINE_ORDER: readonly OrderedTranslationEngine[] = ['cloudflare-ai', 'deepseek', 'gemini'];

const ENGINE_ALIASES: Record<string, OrderedTranslationEngine> = {
  'cloudflare-ai': 'cloudflare-ai',
  cloudflare: 'cloudflare-ai',
  cf: 'cloudflare-ai',
  deepseek: 'deepseek',
  'deepseek-direct': 'deepseek',
  gemini: 'gemini'
};

export const parseEngineOrder = (
  raw: unknown,
  fallback: readonly OrderedTranslationEngine[] = DEFAULT_ENGINE_ORDER
): OrderedTranslationEngine[] => {
  const configured = String(raw || '')
    .split(',')
    .map((item) => ENGINE_ALIASES[item.trim().toLowerCase()])
    .filter((item): item is OrderedTranslationEngine => Boolean(item));
  return Array.from(new Set([...configured, ...fallback]));
};

/** The available engines, in configured order. */
export const orderEngines = <T extends OrderedTranslationEngine>(
  available: readonly T[],
  order: readonly OrderedTranslationEngine[] = DEFAULT_ENGINE_ORDER
): T[] => {
  const rank = (engine: T) => {
    const index = order.indexOf(engine);
    return index === -1 ? order.length : index;
  };
  return [...available].sort((a, b) => rank(a) - rank(b));
};
