// Shared primitives for every rule consumer (translation guard, postprocess, Quality Check Core,
// Excel residue scan, local Agent). Define a pattern here once instead of copying it per module.

export const CJK_REGEX = /[一-鿿]/;
export const CJK_GLOBAL_REGEX = /[一-鿿]/g;

// Column names whose values are identifiers and must never be translated.
export const LOCKED_KEY_REGEX = /(uuid|(^|[_\s-])id$|编号|序号|唯一标识)/i;

export const MEDICAL_CODE_LIST =
  'WBC|RBC|HGB|HCT|MCV|MCHC?|RDW|PLT|NEU|NST|NSG|NSH|LYM|MONO|MON|EOS|BASO|BAS|ALY|LIC|RET|NRBC|AWBC|SRBC';

// Code words: model numbers, interface names and analyte codes that mix letters and digits
// (SpO2, HbA1c, IPX4, CO2, RS232, DC24, R1-A2, SN-01A, HC-5DIFF, COVID-19). A code word has a
// digit, a letter, and either two capitals or a hyphen; "Step1" or "at25" are not code words.
// Number+unit runs ("10mL") start with a digit and are not code words either.
export const CODE_WORD_REGEX =
  /(?<![A-Za-z0-9])(?=[A-Za-z][A-Za-z0-9-]*\d)(?:(?=(?:[A-Za-z0-9-]*[A-Z]){2})|(?=[A-Za-z0-9]+-[A-Za-z0-9]))[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?![A-Za-z0-9])/g;

/** Distinct code words in `text`, in order of first appearance. */
export const extractCodeWords = (text: string) =>
  Array.from(new Set(String(text || '').match(CODE_WORD_REGEX) || []));

// Genera of organisms that veterinary and human POCT texts name (bacteria, fungi, parasites).
// Their Latin scientific names stay in Latin in every target language.
export const ORGANISM_GENUS_LIST =
  'Acinetobacter|Actinomyces|Aelurostrongylus|Anaplasma|Ancylostoma|Angiostrongylus|Aspergillus|Babesia|Bacillus|Bacteroides|Bartonella|Blastomyces|Bordetella|Borrelia|Brucella|Campylobacter|Candida|Chlamydia|Chlamydophila|Clostridium|Clostridioides|Coccidioides|Corynebacterium|Coxiella|Cryptococcus|Cryptosporidium|Ctenocephalides|Cystoisospora|Cytauxzoon|Demodex|Dipylidium|Dirofilaria|Echinococcus|Ehrlichia|Enterobacter|Enterococcus|Escherichia|Francisella|Fusobacterium|Giardia|Haemophilus|Helicobacter|Hepatozoon|Histoplasma|Isospora|Klebsiella|Legionella|Leishmania|Leptospira|Listeria|Malassezia|Microsporum|Mycobacterium|Mycoplasma|Neisseria|Neospora|Nocardia|Otodectes|Pasteurella|Plasmodium|Porphyromonas|Prevotella|Proteus|Pseudomonas|Rickettsia|Salmonella|Sarcoptes|Serratia|Shigella|Staphylococcus|Streptococcus|Taenia|Toxocara|Toxoplasma|Treponema|Trichomonas|Trichophyton|Trichuris|Tritrichomonas|Trypanosoma|Vibrio|Yersinia';
