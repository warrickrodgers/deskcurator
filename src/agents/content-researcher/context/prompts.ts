/**
 * Stage-specific prompt factories for the ContentResearcher pipeline.
 * All JSON-returning prompts strip markdown fences in the caller before parsing.
 */

export function discoverProductsPrompt(topic: string, count: number = 8): string {
  return `You are identifying real purchasable products for a buying guide article.

Topic:
"${topic}"

Task:
Identify ${count} real products that belong in this category.

Rules:
- Only include real products currently sold online
- Each product must include both a brand and model name
- Do NOT include generic product categories
- Do NOT include accessories unrelated to the topic
- Prefer well-known or commonly reviewed products

Respond with ONLY this JSON object:

{
  "products": [
    { "brand": "Brand Name", "model": "Model Name", "name": "Full Product Name" }
  ]
}

Example format:

{
  "products": [
    { "brand": "BenQ", "model": "ScreenBar Halo", "name": "BenQ ScreenBar Halo Monitor Light" },
    { "brand": "Xiaomi", "model": "Mi Computer Monitor Light Bar", "name": "Xiaomi Mi Computer Monitor Light Bar" }
  ]
}`;
}

/**
 * Pre-flight check: determines whether a research topic is a real purchasable
 * product (has a brand + model name) or is a feature, concept, or category.
 * Used to abort the pipeline early and avoid wasting search credits.
 */
export function validateProductPrompt(topic: string): string {
  return `You are validating whether a research topic is a specific purchasable product.

Topic: "${topic}"

A VALID product must have:
- A real brand name (e.g. Herman Miller, FlexiSpot, Uplift, Steelcase, Secretlab, Logitech)
- A specific model name or product line (e.g. Aeron, E7, V2 Commercial, Leap V2)

An INVALID topic is any of:
- A feature or mechanism (e.g. "3D armrest systems", "synchronous tilt", "lumbar support")
- A buying strategy (e.g. "refurbished chairs", "budget standing desks")
- A product category without a specific model (e.g. "ergonomic chairs", "monitor arms")
- A concept or component (e.g. "mesh backrests", "gas lift cylinders")

Respond with ONLY this JSON object, no other text:
{"valid": true, "brand": "Brand Name", "model": "Model Name"}
or:
{"valid": false, "reason": "One sentence explaining why this is not a product"}`;
}

export function analyzeProsConsPrompt(productName: string, searchContent: string): string {
  return `Analyze the following search results about "${productName}" and extract a balanced list of pros and cons.

Search Results:
${searchContent}

Instructions:
- Extract 4–7 genuine pros based on what users and reviewers actually praise
- Extract 3–5 genuine cons based on real complaints and verified limitations
- Be specific — avoid vague claims like "good quality" or "easy to use"
- Each point must be a complete, standalone sentence
- Focus on what matters to desk workers and home office users
- Do not invent information not present in the search results

Respond with ONLY this JSON object, no other text:
{
  "pros": ["Pro sentence 1", "Pro sentence 2"],
  "cons": ["Con sentence 1", "Con sentence 2"]
}`;
}

export function competitorPrompt(
  productName: string,
  category: string,
  searchContent: string
): string {
  return `Based on the following search results, identify the main competitors to "${productName}" in the ${category} category.

Search Results:
${searchContent}

Instructions:
- Identify 3–5 direct competitors that buyers commonly consider alongside this product
- For each, write a single sentence noting the key differentiator (price, quality, features, or target user)
- Only include products that appear in the search results — do not invent competitors

Respond with ONLY this JSON object, no other text:
{
  "competitors": [
    "Competitor Name: key differentiator sentence",
    "Competitor Name: key differentiator sentence"
  ]
}`;
}

export function summaryPrompt(
  productName: string,
  category: string,
  pros: string[],
  cons: string[],
  competitors: string[],
  affiliateTag?: string
): string {
  const affiliateNote = affiliateTag
    ? `\nContext: This content will include an Amazon affiliate link with tag "${affiliateTag}". Frame the purchase recommendation naturally.`
    : '';

  return `Write an affiliate-optimized research summary for "${productName}" (${category}).

Pros:
${pros.map((p) => `- ${p}`).join('\n')}

Cons:
${cons.map((c) => `- ${c}`).join('\n')}

Key Competitors:
${competitors.map((c) => `- ${c}`).join('\n')}
${affiliateNote}

Write 3–4 paragraphs that:
1. Open with who this product is best for and its core value proposition
2. Summarize the key benefits honestly and specifically
3. Address the main drawbacks and which buyers should look elsewhere
4. Close with a clear purchase recommendation and context (when to buy vs. consider an alternative)

Tone: Knowledgeable, direct, and trustworthy — like advice from a friend who researches desk setups professionally.
Write only the summary text. No JSON, no headers, no bullet points.`;
}
