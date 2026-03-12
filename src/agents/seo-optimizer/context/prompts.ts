/**
 * Ask the AI to extract primary/secondary keywords, search intent, an optimised
 * title, a URL slug, a readability grade, thin sections, and competitor gap hints.
 */
export function seoValidationPrompt(title: string, articleExcerpt: string): string {
  return `Analyse this desk-setup affiliate article for SEO.

Article title: "${title}"

Article excerpt (first 3000 chars):
${articleExcerpt}

Return ONLY the following JSON object — no other text, no markdown code fence:
{
  "primaryKeyword": "the single best target search phrase buyers use",
  "secondaryKeywords": ["3-5 semantically related search terms"],
  "searchIntent": "informational|commercial|transactional",
  "suggestedTitle": "optimised title 50-60 chars including primary keyword",
  "suggestedSlug": "url-friendly-slug-no-stop-words",
  "readabilityGrade": 8,
  "thinSections": ["heading text of any H2 section under 80 words"],
  "competitorGaps": ["specific angle or question competitors cover that this article misses"]
}`;
}
