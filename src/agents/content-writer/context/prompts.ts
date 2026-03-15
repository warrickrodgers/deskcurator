import { ResearchFindings } from '../../../types';
import { ArticleType } from '../../../types/jobs';

/**
 * Ask the AI to select the best 3–5 products from a pool of candidates discovered
 * during Phase 1 research. The researcher surfaces ~8 options; this prompt curates
 * down to the strongest candidates for per-product research queuing.
 * Returns a JSON array of product name strings.
 */
export function categoryDiscoveryPrompt(title: string, _productCount: number): string {
  return `You are curating the product list for an article titled: "${title}"

The researcher has surfaced a pool of candidate products. Select the best 3–5 from that pool for in-depth research. Return fewer than 3 only if the pool itself contains fewer strong options.

Selection criteria (in order of importance):
1. Strong brand recognition and availability — real purchasable products with a known brand and model name
2. Variety — cover different price points, form factors, or use cases to serve a wider audience
3. Research potential — products with enough public information to write a detailed section
4. Relevance — directly matches the article topic, not peripheral accessories unless the article is specifically about them

Every selected item MUST:
- Include a brand name and a model name (e.g. "Herman Miller Aeron", "Uplift V2 Commercial")
- Be a real purchasable product — not a feature, mechanism, or buying strategy
- Be distinct from all other selected items (no duplicates or near-duplicates)

Respond with ONLY this JSON array, no other text:
["Brand Model 1", "Brand Model 2", "Brand Model 3"]`;
}

/**
 * Ask the AI to select the best 3–5 products from a research summary that may
 * describe up to ~8 candidate products discovered in Phase 1.
 * Used to curate down to the strongest options before queuing per-product research.
 */
export function categoryExtractionPrompt(summary: string, _productCount: number): string {
  return `The following research summary describes a pool of candidate products relevant to a desk-setup article. Select the best 3–5 specific purchasable products from it.

Text:
${summary}

Selection criteria (in order of importance):
1. Strong brand recognition and real-world availability
2. Variety across price points, form factors, or use cases
3. Sufficient detail in the summary to justify in-depth research
4. Direct relevance to the article topic

Every selected item MUST:
- Include a brand and model name (e.g. "Herman Miller Aeron", "FlexiSpot E7")
- Be explicitly mentioned as a real product in the text — do not invent entries
- Be distinct from all other selected items (no duplicates or near-duplicates)

Return between 3 and 5 items. Return fewer only if the text contains fewer than 3 clear products.

Respond with ONLY this JSON array, no other text:
["Brand Model 1", "Brand Model 2", "Brand Model 3"]`;
}

/**
 * Generate a full buyer's guide article from multiple product research findings.
 */
export function articleGenerationPrompt(
  title: string,
  articleType: ArticleType,
  researchItems: ResearchFindings[],
  affiliateTag?: string
): string {
  const affiliateNote = affiliateTag
    ? `Affiliate links: where included, format as https://www.amazon.com/s?k=PRODUCT+NAME&tag=${affiliateTag} — insert naturally, never forced.`
    : '';

  // Serialise each research item as a labelled JSON block so the model
  // can reference exact field values rather than paraphrasing a prose summary.
  const researchBlock = researchItems
    .map((r, i) => {
      const payload = {
        product: r.product,
        pros: r.pros,
        cons: r.cons,
        competitorAnalysis: r.competitorAnalysis,
        summary: r.summary,
        confidence: r.confidence,
      };
      return `### Research Item ${i + 1}: ${r.product.name}\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
    })
    .join('\n\n');

  const typeInstructions: Record<ArticleType, string> = {
    multi_product: `This is a multi-product buyer's guide. Each product gets its own H3 section containing: a one-sentence positioning statement, a spec-focused bullet list, a pros list, a cons list, and a "Best for" line. Do not pad sections with filler sentences.`,
    single_product: `This is a single-product deep-dive. Use H2 sections: Overview, Key Specifications, Strengths, Weaknesses, Who It Suits, and Verdict. Be specific — pull exact specs and differentiators from the research data.`,
    comparison: `This is a head-to-head comparison. Use H2 sections: At a Glance, Build and Adjustability, Stability and Ergonomics, Value, and Verdict. Include a markdown comparison table after the intro. Base all comparisons strictly on the research data.`,
    roundup: `This is a quick-reference roundup. Each product gets an H3, a one-sentence description, and inline pros/cons bullets. Close with a "Quick Picks" section organised by use case (e.g. best for tall users, best budget option).`,
  };

  return `You are writing a buyer's guide article titled: "${title}"

Article type: ${typeInstructions[articleType]}

---

# Required Article Structure

Use this exact structure. Do not skip or rename sections.

## 1. Introduction (H2)
Open with the core problem the reader is trying to solve.
State what makes this category difficult to navigate (trade-offs, sizing, specs).
Do NOT open with "In this guide" or a generic welcome sentence.
2–3 focused paragraphs maximum.

## 2. Comparison Table (H2)
A markdown table comparing all products across the most relevant spec dimensions.
Derive column headers from the research data (e.g. Max Height, Weight Capacity, Frame Type, Price Range).
Only include columns where data is available across most products.

## 3. Product Sections (H2, then H3 per product)
${typeInstructions[articleType]}

For each product, derive all details from the Research Data section below.
Do not invent specifications, prices, or features not present in the research.
Use the product.name, product.brand, pros, cons, and summary fields directly.
Phrase insights as comparisons where possible.

## 4. Buying Considerations (H2)
2–4 H3 sub-sections covering the most important decision factors for this category.
Examples: "Frame Type and Height Range", "Weight Capacity", "Stability at Full Extension".
Base these on patterns observed across the research data.
No generic advice — every point must connect to a real trade-off in the data.

## 5. Verdict (H2)
Recommend specific products for specific user types.
Format as a short bullet list: "Best for tall users: [product name] — [one-sentence reason]"
Do not declare an overall winner unless the research clearly supports it.

## 6. FAQ (H2)
3–5 questions a buyer in this category would realistically ask.
Answer each in 2–3 sentences using research-backed details, not generic advice.

---

# Writing Rules

- Use concrete details: height ranges, weight limits, frame stages, materials
- Phrase observations as comparisons: "X tends to..." or "compared to Y, this model..."
- Do not claim personal testing
- Do not use banned phrases: "premium quality", "great for productivity", "perfect for any workspace", "industry-leading", "game-changer", "best in class"
- Do not pad sections — if research does not support a claim, omit it
- Keep product section introductions to 1–2 sentences

---

# Research Data

Use the following structured research to generate the article.
All product details, pros, cons, and positioning must be sourced from this data.

${researchBlock}

---

${affiliateNote}

Write the complete article in Markdown now.`;
}

/**
 * Rewrite an article draft incorporating SEO improvement feedback.
 * Used when the SEO optimizer returns a 'revise' decision.
 */
export function articleRevisionPrompt(
  title: string,
  articleType: ArticleType,
  researchItems: ResearchFindings[],
  previousDraft: string,
  improvementSuggestions: string[],
  affiliateTag?: string
): string {
  const basePrompt = articleGenerationPrompt(title, articleType, researchItems, affiliateTag);
  const suggestionBlock = improvementSuggestions.map((s, i) => `${i + 1}. ${s}`).join('\n');

  return `${basePrompt}

---

# REVISION BRIEF

The previous draft was reviewed by the SEO optimizer and returned the following required improvements. You MUST address every point before writing the revised article.

**Required improvements:**
${suggestionBlock}

**Previous draft (for reference — do not copy, rewrite from scratch):**
${previousDraft.substring(0, 4000)}${previousDraft.length > 4000 ? '\n*(truncated)*' : ''}

Write a complete revised article in Markdown that satisfies all the required improvements above.`;
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
