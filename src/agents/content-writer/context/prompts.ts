import { ResearchFindings } from '../../../types';
import { ArticleType } from '../../../types/jobs';

/**
 * Ask the AI to identify N product categories to research for a given article title.
 * Returns a JSON array of category strings.
 */
export function categoryDiscoveryPrompt(title: string, productCount: number): string {
  return `You are planning research for an article titled: "${title}"

Identify 3 to ${productCount} specific purchasable products to research. Return fewer if not enough strong options exist — quality over quantity.

Every item MUST be a real purchasable product with a brand name and a model name.
Do NOT return: features, mechanisms, buying strategies, or product categories without a specific model.

First decide what kind of article this is:

A) Single-category article — the title is about ONE product type (e.g. "Best ergonomic chairs for programmers", "Best standing desk for tall people").
   → Return specific named products (e.g. "Herman Miller Aeron", "Steelcase Leap V2", "Branch Ergonomic Chair").

B) Multi-category article — the title spans several product types (e.g. "Best home office setup for remote workers").
   → Return one specific named product per category (e.g. "Uplift V2 standing desk", "Herman Miller Aeron chair", "Ergotron LX monitor arm").

Requirements:
- Each item must include a brand name and a model name
- No accessories, cables, or peripheral items unless the article is specifically about them
- No overlap

Respond with ONLY this JSON array, no other text:
["Brand Model 1", "Brand Model 2", "Brand Model 3"]`;
}

/**
 * Ask the AI to extract product names from existing research findings.
 * Used to parse products out of an initial discovery research summary.
 */
export function categoryExtractionPrompt(summary: string, productCount: number): string {
  return `The following research summary describes products relevant to a desk-setup article. Extract 3 to ${productCount} specific purchasable products from it.

Text:
${summary}

Every item MUST be a real purchasable product with a brand name and a model name.
Do NOT extract: features, mechanisms, buying strategies, or product categories without a specific model.

Requirements:
- Each item must include a brand and model name (e.g. "Herman Miller Aeron", "FlexiSpot E7")
- Only extract items explicitly mentioned as real products in the text
- Return fewer than ${productCount} if not enough clear products are present — do not invent entries
- No duplicates

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
