// Shared primitives for every rule consumer (translation guard, postprocess, Quality Check Core,
// Excel residue scan, local Agent). Define a pattern here once instead of copying it per module.

export const CJK_REGEX = /[一-鿿]/;
export const CJK_GLOBAL_REGEX = /[一-鿿]/g;

// Column names whose values are identifiers and must never be translated.
export const LOCKED_KEY_REGEX = /(uuid|(^|[_\s-])id$|编号|序号|唯一标识)/i;

export const MEDICAL_CODE_LIST =
  'WBC|RBC|HGB|HCT|MCV|MCHC?|RDW|PLT|NEU|NST|NSG|NSH|LYM|MONO|MON|EOS|BASO|BAS|ALY|LIC|RET|NRBC|AWBC|SRBC';
