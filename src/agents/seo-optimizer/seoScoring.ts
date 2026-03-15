import { SeoChecks } from './seoTypes';

const BANNED_PHRASES = [
  'premium quality',
  'great for productivity',
  'perfect for any workspace',
  'industry-leading',
  'game-changer',
  'best in class',
  'state of the art',
  'cutting-edge',
  'next-level',
  'world-class',
];

// ── Text extraction helpers ────────────────────────────────────────────────

/** Strip markdown syntax and count words in the resulting plain text. */
export function countWords(markdown: string): number {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')       // fenced code blocks
    .replace(/`[^`]+`/g, ' ')              // inline code
    .replace(/!\[.*?\]\(.*?\)/g, ' ')      // images
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1') // links → keep anchor text
    .replace(/#{1,6}\s/g, ' ')             // heading markers
    .replace(/[*_~>|]/g, ' ')              // emphasis, blockquote, table chars
    .replace(/<!--.*?-->/gs, ' ')          // HTML comments
    .replace(/\s+/g, ' ')
    .trim();
  return plain.split(' ').filter(Boolean).length;
}

export interface Heading {
  level: number;
  text: string;
}

/** Extract all headings as { level, text } objects in document order. */
export function extractHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  for (const line of markdown.split('\n')) {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].trim() });
    }
  }
  return headings;
}

/** Return the text of the first H1, or undefined if none exists. */
export function extractH1(markdown: string): string | undefined {
  return extractHeadings(markdown).find((h) => h.level === 1)?.text;
}

/**
 * Return the first N words of article body prose.
 * Skips heading lines so the "intro" is the actual paragraph text.
 */
export function getFirstNWords(markdown: string, n: number): string {
  const lines = markdown
    .split('\n')
    .filter((l) => l.trim() && !l.match(/^#{1,6}\s/) && !l.match(/^<!--/));

  const bodyText = lines
    .join(' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    .replace(/[*_~>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return bodyText.split(' ').slice(0, n).join(' ');
}

// ── Individual checks ──────────────────────────────────────────────────────

/** Title should be 50–60 characters for optimal SERP display. */
export function checkTitleLength(title: string): boolean {
  return title.length >= 50 && title.length <= 60;
}

/** Meta description must exist and be 150–160 characters. */
export function checkMetaDescription(meta: string): boolean {
  return meta.length >= 150 && meta.length <= 160;
}

/** Article should contain at least 3 H2 sections. */
export function checkH2Sections(markdown: string): boolean {
  return extractHeadings(markdown).filter((h) => h.level === 2).length >= 3;
}

/** Primary keyword must appear in the first 150 words of body prose. */
export function checkKeywordInIntro(markdown: string, keyword: string): boolean {
  const intro = getFirstNWords(markdown, 150).toLowerCase();
  return intro.includes(keyword.toLowerCase());
}

/** Affiliate articles should be at least 1500 words. */
export function checkWordCount(markdown: string, min = 1500): boolean {
  return countWords(markdown) >= min;
}

/**
 * Heading hierarchy must not skip levels.
 * e.g. H1 → H3 (skipping H2) is invalid; H1 → H2 → H4 is also invalid.
 */
export function checkHeadingHierarchy(markdown: string): boolean {
  const headings = extractHeadings(markdown);
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level > headings[i - 1].level + 1) return false;
  }
  return true;
}

/** Return any banned phrases found in the article (case-insensitive). */
export function findBannedPhrases(markdown: string): string[] {
  const lower = markdown.toLowerCase();
  return BANNED_PHRASES.filter((p) => lower.includes(p));
}

/** Check the article contains at least one Amazon affiliate link with tag parameter. */
export function checkAffiliateLinks(markdown: string): boolean {
  return /amazon\.com\/.*tag=/.test(markdown);
}

/** Buyer's guide articles must cover at least 3 distinct products. */
export function checkProductCount(productCount: number, min = 3): boolean {
  return productCount >= min;
}

// ── Composite scorer ───────────────────────────────────────────────────────

export interface ScoreResult {
  score: number;
  checks: SeoChecks;
  passed: string[];
  warnings: string[];
  failures: string[];
  wordCount: number;
}

/**
 * Run all deterministic SEO checks and compute a final score clamped to 0–100.
 *
 * Deductions:
 *   Title outside 50–60 chars         → -5
 *   Meta description wrong/missing    → -10
 *   Fewer than 3 H2 sections          → -15  (auto-fail)
 *   Primary keyword not in first 150w → -15  (auto-fail)
 *   Word count < 1500                 → -15  (auto-fail)
 *   Product count < 3                 → -15  (auto-fail)
 *   No affiliate links                → -10  (auto-fail)
 *   Heading hierarchy skips           → -5
 *   Each banned phrase (max 3)        → -5 each
 */
export function scoreArticle(
  markdown: string,
  title: string,
  metaDescription: string,
  primaryKeyword: string,
  productCount: number = 0
): ScoreResult {
  const passed: string[] = [];
  const warnings: string[] = [];
  const failures: string[] = [];
  let score = 100;

  const wordCount = countWords(markdown);

  // Title length
  const titleOk = checkTitleLength(title);
  if (titleOk) {
    passed.push(`Title length: ${title.length} chars (target 50–60)`);
  } else {
    score -= 5;
    warnings.push(`Title length: ${title.length} chars — target 50–60`);
  }

  // Meta description
  const metaOk = checkMetaDescription(metaDescription);
  if (metaOk) {
    passed.push(`Meta description: ${metaDescription.length} chars (target 150–160)`);
  } else {
    score -= 10;
    failures.push(`Meta description: ${metaDescription.length} chars — must be 150–160`);
  }

  // H2 sections (auto-fail)
  const h2Count = extractHeadings(markdown).filter((h) => h.level === 2).length;
  const hasH2 = h2Count >= 3;
  if (hasH2) {
    passed.push(`H2 sections: ${h2Count} found (minimum 3)`);
  } else {
    score -= 15;
    failures.push(`H2 sections: ${h2Count} found — minimum 3 required`);
  }

  // Keyword in intro (auto-fail)
  const keywordInIntro = checkKeywordInIntro(markdown, primaryKeyword);
  if (keywordInIntro) {
    passed.push(`Primary keyword "${primaryKeyword}" present in first 150 words`);
  } else {
    score -= 15;
    failures.push(`Primary keyword "${primaryKeyword}" not found in first 150 words`);
  }

  // Word count (auto-fail)
  const wcOk = checkWordCount(markdown);
  if (wcOk) {
    passed.push(`Word count: ${wordCount} (minimum 1500)`);
  } else {
    score -= 15;
    failures.push(`Word count: ${wordCount} — minimum 1500 for affiliate articles`);
  }

  // Product count (auto-fail)
  const pcOk = checkProductCount(productCount);
  if (pcOk) {
    passed.push(`Product count: ${productCount} products covered (minimum 3)`);
  } else {
    score -= 15;
    failures.push(`Product count: ${productCount} — minimum 3 products required`);
  }

  // Heading hierarchy
  const hierarchyOk = checkHeadingHierarchy(markdown);
  if (hierarchyOk) {
    passed.push('Heading hierarchy: no skipped levels');
  } else {
    score -= 5;
    warnings.push('Heading hierarchy: one or more levels skipped (e.g. H1 → H3)');
  }

  // Banned phrases
  const banned = findBannedPhrases(markdown);
  if (banned.length === 0) {
    passed.push('No banned phrases detected');
  } else {
    const deduction = Math.min(banned.length * 5, 15);
    score -= deduction;
    warnings.push(`Banned phrases found (${banned.length}): ${banned.join(', ')}`);
  }

  // Affiliate links (auto-fail)
  const hasLinks = checkAffiliateLinks(markdown);
  if (hasLinks) {
    passed.push('Amazon affiliate links present');
  } else {
    score -= 10;
    failures.push('No Amazon affiliate links — all reviewed products must have an affiliate link');
  }

  const checks: SeoChecks = {
    titleLengthOk: titleOk,
    metaDescriptionOk: metaOk,
    hasH2Sections: hasH2,
    keywordInIntro,
    sufficientWordCount: wcOk,
    sufficientProductCount: pcOk,
    headingHierarchyOk: hierarchyOk,
    noBannedPhrases: banned.length === 0,
    affiliateLinksPresent: hasLinks,
  };

  return {
    score: Math.max(0, Math.min(100, score)),
    checks,
    passed,
    warnings,
    failures,
    wordCount,
  };
}
