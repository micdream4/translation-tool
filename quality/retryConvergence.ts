// Retry convergence: stop re-sending a segment the model keeps returning unchanged.
//
// "Retry flagged items" used to loop forever on text the model deliberately keeps (a name, an
// address, a fixed expression): QA flags it, the retry sends it back, the model keeps it again.
// Each retry outcome is recorded here; once the same source has come back with the same
// translation STUCK_AFTER times, the segment is excluded from automatic retries and its
// residue finding is downgraded to low severity ("needs confirmation"), so a person decides.
import { hashIssueText } from '../utils/issueCases';

export const STUCK_AFTER = 2;

const outcomes = new Map<string, { translatedHash: string; repeats: number }>();

const keyFor = (targetLang: string | undefined, sourceText: string) =>
  `${String(targetLang || '').toLowerCase()}|${hashIssueText(sourceText)}`;

/**
 * Record what a retry produced for one segment. `before` is the text that was flagged and sent
 * for retry, `after` the text the retry produced.
 */
export const noteRetryOutcome = (
  targetLang: string | undefined,
  sourceText: string,
  before: string,
  after: string
) => {
  if (!String(sourceText || '').trim()) return;
  const key = keyFor(targetLang, sourceText);
  const afterHash = hashIssueText(after);
  const unchanged = hashIssueText(before) === afterHash;
  const previous = outcomes.get(key);
  if (!unchanged) {
    outcomes.set(key, { translatedHash: afterHash, repeats: 0 });
    return;
  }
  const repeats = previous && previous.translatedHash === afterHash ? previous.repeats + 1 : 1;
  outcomes.set(key, { translatedHash: afterHash, repeats });
};

export const isRetryStuck = (targetLang: string | undefined, sourceText: string, translatedText: string) => {
  if (!outcomes.size) return false;
  const entry = outcomes.get(keyFor(targetLang, sourceText));
  return Boolean(entry && entry.repeats >= STUCK_AFTER && entry.translatedHash === hashIssueText(translatedText));
};

export const resetRetryConvergence = () => {
  outcomes.clear();
};
