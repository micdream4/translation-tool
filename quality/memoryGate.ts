import type { TargetLanguage } from '../types';
import { segmentsToQualityUnits } from './adapters';
import { runQualityChecksOnUnits } from './checks';

/**
 * A translation is only remembered (or reused from memory) when the shared quality checks find
 * nothing wrong with it: no empty reply, no placeholder fragment (__ID_0), no lost code word,
 * no glued words, no source-language or Chinese residue, no verbatim copy of the source prose.
 * The same checks run on every DOCX/PDF/Excel result, so memory never keeps what QA would flag.
 */
export const isTrustedMemoryPair = (sourceText: string, targetText: string, targetLang: TargetLanguage) => {
  const source = String(sourceText || '').trim();
  const target = String(targetText || '').trim();
  if (!source || !target) return false;
  const report = runQualityChecksOnUnits(
    segmentsToQualityUnits([{ id: 'memory', original: source }], 'docx', () => target),
    { targetLang }
  );
  const { issues } = report;
  return (
    issues.emptyTranslations.length === 0 &&
    issues.placeholders.length === 0 &&
    issues.idMismatch.length === 0 &&
    issues.chinese.length === 0 &&
    issues.nonTargetLanguage.length === 0 &&
    !issues.spacing.some((issue) => issue.severity === 'high')
  );
};
