// Types shared between App.tsx and the translator components.

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
