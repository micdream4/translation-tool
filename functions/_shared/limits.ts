import { jsonResponse } from "./auth";

type Env = Record<string, unknown>;

export const DEFAULT_MAX_REQUEST_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_RECORDS = 200;
export const DEFAULT_MAX_SAMPLES = 100;
export const MAX_MODELS_PER_REQUEST = 8;

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/;

const readPositiveInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

export const getMaxRequestBytes = (env: Env) =>
  readPositiveInt(env.MAX_REQUEST_BYTES, DEFAULT_MAX_REQUEST_BYTES);

export const getMaxRecords = (env: Env) => readPositiveInt(env.MAX_RECORDS_PER_REQUEST, DEFAULT_MAX_RECORDS);

export const getMaxSamples = (env: Env) => readPositiveInt(env.MAX_SAMPLES_PER_REQUEST, DEFAULT_MAX_SAMPLES);

export const isValidModelId = (value: string) => MODEL_ID_PATTERN.test(value);

/** Returns an error message when any model id is malformed or the list is too long. */
export const validateModelList = (models: string[]) => {
  if (models.length > MAX_MODELS_PER_REQUEST) {
    return `Too many models requested (max ${MAX_MODELS_PER_REQUEST}).`;
  }
  const invalid = models.find((model) => !isValidModelId(model));
  return invalid ? "Invalid model id." : "";
};

/** Reads a JSON body while enforcing a byte limit, both by Content-Length and by actual size. */
export const readJsonBodyWithLimit = async (
  request: Request,
  maxBytes: number
): Promise<{ data?: any; response?: Response }> => {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maxBytes) {
    return { response: jsonResponse({ error: "Request body too large." }, 413) };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    return { response: jsonResponse({ error: "Request body too large." }, 413) };
  }
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { response: jsonResponse({ error: "Invalid JSON body." }, 400) };
  }
};
