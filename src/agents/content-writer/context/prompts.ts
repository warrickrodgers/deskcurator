import { ResearchFindings } from '../../../types';
import { ArticleType } from '../../../types/jobs';

/**
 * Ask the AI to identify N product categories to research for a given article title.
 * Returns a JSON array of category strings.
 */
export function categoryDiscoveryPrompt(title: string, productCount: number): string {
  return `You are planning a "${title}" article. Identify exactly ${productCount} distinct product categories that would be most valuable to include.

Requirements:
- Each category should be a specific type of product (e.g. "standing desk", "ergonomic chair", "monitor arm")
- Categories must be realistic desk-setup products people actually buy
- No overlap between categories
- Optimise for the article title — pick what readers of this article care most about

Respond with ONLY this JSON array, no other text:
["Category 1", "Category 2", "Category 3"]`;
}

/**
 * Ask the AI to extract product categories from existing research findings.
 * Used to parse categories out of an initial discovery research summary.
 */
export function categoryExtractionPrompt(summary: string, productCount: number): string {
  return `The following text describes product categories relevant to a desk-setup article. Extract exactly ${productCount} specific, distinct product categories mentioned or implied.

Text:
${summary}

Requirements:
- Each category must be a concrete product type (e.g. "standing desk", "monitor arm")
- Prefer categories explicitly mentioned in the text
- If fewer than ${productCount} are clearly mentioned, infer sensible additions from context
- No duplicates

Respond with ONLY this JSON array, no other text:
["Category 1", "Category 2", "Category 3"]`;
}

/**
 * Generate a full affiliate article from multiple product research findings.
 */
export function articleGenerationPrompt(
  title: string,
  articleType: ArticleType,
  researchItems: ResearchFindings[],
  affiliateTag?: string
): string {
  const affiliateNote = affiliateTag
    ? `\nAffiliate context: Use Amazon affiliate links with tag "${affiliateTag}". Format links as: https://www.amazon.com/s?k=PRODUCT+NAME&tag=${affiliateTag}`
    : '';

  const researchBlock = researchItems
    .map(
      (r, i) => `
--- PRODUCT ${i + 1}: ${r.product.name} ---
Category: ${r.product.category}
Confidence: ${(r.confidence * 100).toFixed(0)}%
Pros:
${r.pros.map((p) => `  - ${p}`).join('\n')}
Cons:
${r.cons.map((c) => `  - ${c}`).join('\n')}
Competitors: ${r.competitorAnalysis.join(', ')}
Summary: ${r.summary}
`
    )
    .join('\n');

  const typeInstructions: Record<ArticleType, string> = {
    multi_product: `Write a multi-product roundup. Each product gets its own H2 section with: a brief intro, pros list, cons list, who it's best for, and an affiliate link. End with an "Our Verdict" section ranking the products by use case.`,
    single_product: `Write an in-depth single-product review. Use H2 sections for: Overview, Key Features, Pros & Cons, Who It's For, and Final Verdict. Include the affiliate link in the Final Verdict CTA.`,
    comparison: `Write a head-to-head comparison article. Open with an overview of both products. Use H2 sections comparing: Design & Build, Performance, Value, and Verdict. Include a comparison summary table in markdown.`,
    roundup: `Write a product roundup with brief but punchy coverage of each item. Each product gets an H3 with 2–3 sentences, key pros/cons as inline bullets, and an affiliate link. End with quick-pick recommendations by budget.`,
  };

  return `${affiliateNote}

Article type instructions: ${typeInstructions[articleType]}

Structure:
1. H1: ${title}
2. Brief intro (2–3 sentences) — why this topic matters and what readers will find
3. Per-product sections (see type instructions above)
4. Verdict / final recommendations section
5. Brief closing CTA

Research data:
${researchBlock}

Write the complete article in markdown. Be specific, honest, and genuinely helpful.`;
}

/**
 * Generate an SEO meta description for a published article.
 */
export function seoMetaPrompt(title: string, articleContent: string): string {
  const excerpt = articleContent.substring(0, 2000);
  return `Write an SEO meta description for the following article.

Article title: "${title}"
Article excerpt:
${excerpt}

Requirements:
- Exactly 150–160 characters including spaces
- Include the primary topic and a benefit/hook
- Natural, compelling language — not keyword-stuffed
- No quotation marks in the output

Respond with ONLY the meta description text, nothing else.`;
}
