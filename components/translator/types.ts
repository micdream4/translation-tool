// Types shared between App.tsx and the translator components.
import type { ModelReviewStyle } from '../../utils/modelReview';

export type AppView = 'translator' | 'modelReview';
export type ModelReviewStyleSelection = 'recommended' | ModelReviewStyle;

export type DocxIssueDetail = {
  index: number;
  id: string;
  locationLabel?: string;
  text: string;
  snippet: string;
  chineseChars: number;
  lowPriority: boolean;
  issueType: 'source' | 'placeholder' | 'glue';
};
