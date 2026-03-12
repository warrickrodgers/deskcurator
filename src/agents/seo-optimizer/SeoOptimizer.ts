import * as fs from 'fs';
import * as path from 'path';
import logger from '../../utils/logger';
import discordService from '../../services/discord';
import { writerAiService } from '../../services/ai.service';
import { databaseService } from '../../services/database.service';
import { SEO_SYSTEM_PROMPT, seoValidationPrompt } from './context';
import { scoreArticle, extractH1, extractHeadings, checkHeadingHierarchy } from './seoScoring';
import { SeoResult, SeoMetadata, SeoAuditReport, AiSeoValidation } from './seoTypes';
import config from '../../config/env';

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'articles');

export class SeoOptimizer {
  constructor() {
    logger.info('SeoOptimizer agent initialized');
  }

  /**
   * Run SEO optimization on an approved article.
   *
   * Pipeline:
   *   1. Load article from DB
   *   2. Set status → seo_optimizing
   *   3. Parse draft and meta description
   *   4. AI validation: primary keyword, title, slug, readability
   *   5. Apply light markdown improvements (H1, heading hierarchy)
   *   6. Deterministic scoring
   *   7. Build SeoMetadata + SeoAuditReport
   *   8. Persist seo_report to DB, set status → seo_completed
   *   9. Write seo_metadata.json to output directory
   *  10. Send audit summary to Discord thread
   *  11. Return SeoResult for ContentWriter to publish
   */
  async run(articleId: string): Promise<SeoResult> {
    const article = databaseService.getArticleJobById(articleId);
    if (!article) throw new Error(`SeoOptimizer: no article found with ID ${articleId}`);
    if (!article.draftContent) throw new Error(`SeoOptimizer: article ${articleId} has no draft content`);

    logger.info(`SEO optimization started for article ${articleId}: "${article.title}"`);
    databaseService.updateArticleJob(articleId, { status: 'seo_optimizing' });

    const { articleMarkdown, metaDescription } = this.splitDraft(article.draftContent);

    // ── AI validation ──────────────────────────────────────────────────────
    let aiValidation: AiSeoValidation;
    try {
      const raw = await writerAiService.ask(
        seoValidationPrompt(article.title, articleMarkdown.substring(0, 3000)),
        SEO_SYSTEM_PROMPT
      );
      aiValidation = this.parseAiValidation(raw, article.title);
    } catch (error) {
      logger.warn(`SEO AI validation failed for article ${articleId} — using fallback keyword`, error);
      aiValidation = this.fallbackValidation(article.title);
    }

    // ── Light markdown improvements ────────────────────────────────────────
    const optimizedMarkdown = this.applyImprovements(
      articleMarkdown,
      article.title,
      aiValidation
    );

    // ── Deterministic scoring ──────────────────────────────────────────────
    const effectiveMeta = metaDescription || aiValidation.suggestedTitle;
    const scoreResult = scoreArticle(
      optimizedMarkdown,
      aiValidation.suggestedTitle || article.title,
      effectiveMeta,
      aiValidation.primaryKeyword
    );

    // ── Build output structures ────────────────────────────────────────────
    const seoMetadata: SeoMetadata = {
      title: aiValidation.suggestedTitle || article.title,
      slug: aiValidation.suggestedSlug || this.buildSlug(article.title),
      metaDescription: effectiveMeta,
      targetKeywords: [aiValidation.primaryKeyword, ...aiValidation.secondaryKeywords],
      internalLinks: [],
      seoScore: scoreResult.score,
      seoChecks: scoreResult.checks,
    };

    const auditReport: SeoAuditReport = {
      passed: scoreResult.passed,
      warnings: scoreResult.warnings,
      failures: scoreResult.failures,
      keywords: {
        primary: aiValidation.primaryKeyword,
        secondary: aiValidation.secondaryKeywords,
      },
      wordCount: scoreResult.wordCount,
      readabilityGrade: aiValidation.readabilityGrade,
      searchIntent: aiValidation.searchIntent,
      thinSections: aiValidation.thinSections,
      competitorGaps: aiValidation.competitorGaps,
      seoScore: scoreResult.score,
      metadata: seoMetadata,
    };

    // ── Persist to DB ──────────────────────────────────────────────────────
    databaseService.updateArticleJob(articleId, {
      status: 'seo_completed',
      seoReport: JSON.stringify(auditReport),
    });

    // ── Write seo_metadata.json ────────────────────────────────────────────
    this.writeSeoMetadata(articleId, seoMetadata);

    // ── Notify SEO channel ─────────────────────────────────────────────────
    await this.notifyAudit(config.discord.seoChannelId, auditReport, article.title, articleId);

    logger.info(
      `SEO optimization complete for article ${articleId} — score: ${scoreResult.score}/100 ` +
      `(${scoreResult.passed.length} passed, ${scoreResult.warnings.length} warnings, ${scoreResult.failures.length} failures)`
    );

    return {
      optimizedMarkdown: `${optimizedMarkdown}\n\n---\n*Meta description: ${effectiveMeta}*`,
      seoMetadata,
      auditReport,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Split the ContentWriter's combined draft back into the article body and
   * the meta description. ContentWriter appends:
   *   \n\n---\n*Meta description: <text>*
   */
  private splitDraft(fullDraft: string): { articleMarkdown: string; metaDescription: string } {
    const metaMatch = fullDraft.match(/\n\n---\n\*Meta description: (.+)\*\s*$/s);
    if (metaMatch) {
      const articleMarkdown = fullDraft.slice(0, fullDraft.length - metaMatch[0].length).trim();
      return { articleMarkdown, metaDescription: metaMatch[1].trim() };
    }
    return { articleMarkdown: fullDraft.trim(), metaDescription: '' };
  }

  /**
   * Apply conservative structural improvements to the markdown.
   * Never rewrites paragraphs or sentences.
   */
  private applyImprovements(
    markdown: string,
    articleTitle: string,
    aiValidation: AiSeoValidation
  ): string {
    let result = markdown;

    // Ensure H1 exists — use AI suggested title or fall back to article title
    const h1 = extractH1(result);
    const targetH1 = aiValidation.suggestedTitle || articleTitle;
    if (!h1) {
      result = `# ${targetH1}\n\n${result}`;
      logger.debug('SEO: inserted missing H1');
    } else if (h1.toLowerCase() === articleTitle.toLowerCase() && aiValidation.suggestedTitle) {
      // Replace H1 only if it's the raw article title and we have a better suggestion
      result = result.replace(/^#{1}\s+.+$/m, `# ${aiValidation.suggestedTitle}`);
      logger.debug(`SEO: updated H1 from "${h1}" to "${aiValidation.suggestedTitle}"`);
    }

    // Fix heading hierarchy: collapse any skipped heading levels
    if (!checkHeadingHierarchy(result)) {
      result = this.fixHeadingHierarchy(result);
      logger.debug('SEO: fixed heading hierarchy');
    }

    return result;
  }

  /**
   * Repair skipped heading levels by stepping levels down one at a time.
   * e.g. H1 → H3 becomes H1 → H2 for that heading.
   * Does not change heading text.
   */
  private fixHeadingHierarchy(markdown: string): string {
    const lines = markdown.split('\n');
    let prevLevel = 0;
    const fixed: string[] = [];

    for (const line of lines) {
      const match = line.match(/^(#{1,6})\s+(.+)/);
      if (!match) {
        fixed.push(line);
        continue;
      }
      const desiredLevel = match[1].length;
      const text = match[2];
      // Cap to prevLevel + 1 to prevent skips; but never go below 1
      const correctedLevel = prevLevel === 0
        ? desiredLevel
        : Math.min(desiredLevel, prevLevel + 1);
      fixed.push(`${'#'.repeat(correctedLevel)} ${text}`);
      prevLevel = correctedLevel;
    }

    return fixed.join('\n');
  }

  private parseAiValidation(raw: string, fallbackTitle: string): AiSeoValidation {
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (typeof parsed.primaryKeyword === 'string') {
        return {
          primaryKeyword: parsed.primaryKeyword,
          secondaryKeywords: Array.isArray(parsed.secondaryKeywords) ? parsed.secondaryKeywords : [],
          searchIntent: parsed.searchIntent ?? 'commercial',
          suggestedTitle: parsed.suggestedTitle ?? fallbackTitle,
          suggestedSlug: parsed.suggestedSlug ?? this.buildSlug(fallbackTitle),
          readabilityGrade: typeof parsed.readabilityGrade === 'number' ? parsed.readabilityGrade : 8,
          thinSections: Array.isArray(parsed.thinSections) ? parsed.thinSections : [],
          competitorGaps: Array.isArray(parsed.competitorGaps) ? parsed.competitorGaps : [],
        };
      }
      throw new Error('Unexpected AI validation JSON shape');
    } catch {
      logger.warn('Could not parse AI SEO validation response — using fallback');
      return this.fallbackValidation(fallbackTitle);
    }
  }

  private fallbackValidation(title: string): AiSeoValidation {
    // Derive a best-effort keyword from the article title
    const keyword = title
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\b(best|top|guide|for|the|a|an|and|or|of|in|to)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 5)
      .join(' ');

    return {
      primaryKeyword: keyword || title.toLowerCase(),
      secondaryKeywords: [],
      searchIntent: 'commercial',
      suggestedTitle: title,
      suggestedSlug: this.buildSlug(title),
      readabilityGrade: 8,
      thinSections: [],
      competitorGaps: [],
    };
  }

  private buildSlug(title: string): string {
    const stopWords = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'to', 'for', 'with', 'on', 'at']);
    return title
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .split(' ')
      .filter((w) => w && !stopWords.has(w))
      .join('-');
  }

  private writeSeoMetadata(articleId: string, metadata: SeoMetadata): void {
    try {
      if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      }
      const filepath = path.join(OUTPUT_DIR, `${articleId}_seo.json`);
      fs.writeFileSync(filepath, JSON.stringify(metadata, null, 2), 'utf8');
      logger.info(`SEO metadata written to ${filepath}`);
    } catch (error) {
      logger.warn('Failed to write seo_metadata.json — continuing without it', error);
    }
  }

  private async notifyAudit(
    channelId: string,
    report: SeoAuditReport,
    title: string,
    articleId: string
  ): Promise<void> {
    const scoreEmoji = report.seoScore >= 80 ? '🟢' : report.seoScore >= 60 ? '🟡' : '🔴';
    const lines = [
      `${scoreEmoji} **SEO Audit Complete** — score **${report.seoScore}/100**`,
      `📄 "${title}" · ID: \`${articleId}\``,
      `📊 ${report.wordCount} words · Grade ${report.readabilityGrade} reading level · Intent: ${report.searchIntent} · Keyword: \`${report.keywords.primary}\``,
      '',
      `✅ **${report.passed.length} passed** · ⚠️ **${report.warnings.length} warnings** · ❌ **${report.failures.length} failures**`,
    ];

    if (report.failures.length > 0) {
      lines.push('', '**Failures:**', ...report.failures.map((f) => `  ❌ ${f}`));
    }
    if (report.warnings.length > 0) {
      lines.push('', '**Warnings:**', ...report.warnings.map((w) => `  ⚠️ ${w}`));
    }
    if (report.competitorGaps.length > 0) {
      lines.push('', '**Competitor gaps:**', ...report.competitorGaps.map((g) => `  💡 ${g}`));
    }

    await discordService.sendNotification(lines.join('\n'), channelId).catch((err) => {
      logger.warn('Failed to send SEO audit notification to Discord', err);
    });
  }
}

export default SeoOptimizer;
