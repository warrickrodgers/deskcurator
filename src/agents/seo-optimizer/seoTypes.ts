export interface SeoChecks {
  titleLengthOk: boolean;
  metaDescriptionOk: boolean;
  hasH2Sections: boolean;
  keywordInIntro: boolean;
  sufficientWordCount: boolean;
  sufficientProductCount: boolean;
  headingHierarchyOk: boolean;
  noBannedPhrases: boolean;
  affiliateLinksPresent: boolean;
}

/** Decision tier returned by the SEO optimizer after scoring. */
export type SeoDecision = 'approved' | 'revise' | 'fail';

export interface SeoMetadata {
  title: string;
  slug: string;
  metaDescription: string;
  targetKeywords: string[];
  /** Placeholder internal link topics inserted as HTML comments. */
  internalLinks: string[];
  seoScore: number;
  seoChecks: SeoChecks;
}

export interface SeoAuditReport {
  passed: string[];
  warnings: string[];
  failures: string[];
  keywords: {
    primary: string;
    secondary: string[];
  };
  wordCount: number;
  readabilityGrade: number;
  searchIntent: string;
  thinSections: string[];
  competitorGaps: string[];
  seoScore: number;
  metadata: SeoMetadata;
}

export interface SeoResult {
  optimizedMarkdown: string;
  seoMetadata: SeoMetadata;
  auditReport: SeoAuditReport;
  decision: SeoDecision;
  /** Actionable improvement suggestions returned when decision is 'revise'. */
  improvementSuggestions: string[];
}

/** Shape returned by the AI SEO validation prompt. */
export interface AiSeoValidation {
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent: 'informational' | 'commercial' | 'transactional';
  suggestedTitle: string;
  suggestedSlug: string;
  readabilityGrade: number;
  thinSections: string[];
  competitorGaps: string[];
}
