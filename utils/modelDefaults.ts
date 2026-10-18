// Built-in model lists, used only when the deployment config (wrangler.toml [vars]) does not set
// them. Keep these in line with wrangler.toml; a regression test compares the two, so a lost
// variable never quietly brings back an old or more expensive model.
export const DEFAULT_CLOUDFLARE_AI_PRIMARY_MODELS = ['google/gemini-3.6-flash'] as const;
export const DEFAULT_CLOUDFLARE_AI_FALLBACK_MODELS = ['google/gemini-3-flash'] as const;
export const DEFAULT_CLOUDFLARE_AI_MODELS = [
  ...DEFAULT_CLOUDFLARE_AI_PRIMARY_MODELS,
  ...DEFAULT_CLOUDFLARE_AI_FALLBACK_MODELS
] as const;
export const DEFAULT_DEEPSEEK_MODELS = ['deepseek-flash'] as const;

export const DEFAULT_MODEL_REVIEW_TRANSLATION_MODELS = [
  'cloudflare-ai:google/gemini-3-flash',
  'deepseek:deepseek-v4-flash',
  'deepseek:deepseek-v4-pro',
  'cloudflare-ai:openai/gpt-5.4',
  'cloudflare-ai:anthropic/claude-sonnet-4.6'
];

export const DEFAULT_MODEL_REVIEW_JUDGE_MODELS = [
  'cloudflare-ai:openai/gpt-5.4',
  'cloudflare-ai:anthropic/claude-sonnet-4.6',
  'deepseek:deepseek-v4-pro'
];

// AI sample review tries these in order: the cheaper models first.
export const DEFAULT_SAMPLE_REVIEW_MODELS = [
  'deepseek:deepseek-flash',
  'cloudflare-ai:google/gemini-3.6-flash'
];
