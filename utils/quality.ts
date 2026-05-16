export {
  PLACEHOLDER_REGEX,
  collectPlaceholderIssues,
  getSpacingSeverity,
  hasGlueIssue,
  hasSpacingIssue,
  runQualityChecks,
  runQualityChecksOnUnits
} from '../quality/checks';

export type {
  QualityCheckInput,
  QualityCheckOptions,
  QualityIssue,
  QualityIssueType,
  QualityReport,
  QualitySeverity,
  QualityUnit
} from '../quality/checks';
