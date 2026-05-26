export interface AdaptiveTextBatchOptions<T> {
  items: T[];
  getText: (item: T) => string;
  maxItems: number;
  maxChars: number;
}

const getTextLength = (text: string) => Math.max(1, String(text || "").length);

export const sumBatchTextChars = <T>(items: T[], getText: (item: T) => string) =>
  items.reduce((sum, item) => sum + getTextLength(getText(item)), 0);

export const buildAdaptiveTextBatches = <T>({
  items,
  getText,
  maxItems,
  maxChars
}: AdaptiveTextBatchOptions<T>): T[][] => {
  const safeMaxItems = Math.max(1, Math.floor(maxItems));
  const safeMaxChars = Math.max(1, Math.floor(maxChars));
  const batches: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;

  items.forEach((item) => {
    const itemChars = getTextLength(getText(item));
    const shouldStartNext =
      current.length > 0 &&
      (current.length >= safeMaxItems || currentChars + itemChars > safeMaxChars);

    if (shouldStartNext) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(item);
    currentChars += itemChars;
  });

  if (current.length > 0) batches.push(current);
  return batches;
};

export const formatElapsedSeconds = (elapsedMs: number) =>
  `${Math.max(0, elapsedMs / 1000).toFixed(1)}s`;
