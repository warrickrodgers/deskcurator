import { randomUUID } from 'crypto';
import logger from '../../utils/logger';
import discordService from '../../services/discord';
import { aiService } from '../../services/ai.service';
import { searchService, SearchResult } from '../../services/search.service';
import { chromaService } from '../../services/chroma.service';
import { databaseService } from '../../services/database.service';
import { SYSTEM_PROMPT, analyzeProsConsPrompt, competitorPrompt, summaryPrompt } from './context';
import { ResearchFindings, Product, ApprovalRequest, Source } from '../../types';
import config from '../../config/env';

const HIGH_CREDIBILITY_DOMAINS = [
  'amazon.com',
  'rtings.com',
  'wirecutter.com',
  'techradar.com',
  'pcmag.com',
  'tomsguide.com',
  'reddit.com',
  'desksetup.io',
  'thewirecutter.com',
];

export class ContentResearcher {
  private isRunning = false;

  constructor() {
    logger.info('ContentResearcher agent initialized');
  }

  async start(): Promise<void> {
    this.isRunning = true;
    logger.info('ContentResearcher agent started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    logger.info('ContentResearcher agent stopped');
  }

  async researchProduct(productQuery: string): Promise<ResearchFindings | null> {
    const jobId = randomUUID();
    logger.info(`Research job ${jobId} started for: "${productQuery}"`);

    try {
      // 1. Build initial product record from the query
      const product = this.buildProduct(productQuery);

      // 2. ChromaDB dedup check — skip if very similar research already exists
      const isDuplicate = await chromaService.hasSimilarResearch(
        product.name,
        product.category,
        productQuery
      );
      if (isDuplicate) {
        logger.info(`Skipping "${productQuery}" — similar research already stored`);
        return null;
      }

      // 3. Persist initial records to SQLite
      databaseService.insertProduct({
        id: product.id,
        name: product.name,
        category: product.category,
        price: product.price,
        url: product.url,
        affiliateLink: product.affiliateLink,
      });
      databaseService.insertResearchJob({
        id: jobId,
        productId: product.id,
        status: 'running',
        searchQuery: productQuery,
      });

      // 4. Run three Tavily searches in parallel
      logger.info('Running web searches (info, reviews, competitors)...');
      const [infoResults, reviewResults, competitorResults] = await Promise.all([
        searchService.searchProductInfo(productQuery),
        searchService.searchProductReviews(productQuery),
        searchService.searchCompetitors(productQuery, product.category),
      ]);

      logger.info(
        `Search complete: ${infoResults.length} info, ${reviewResults.length} review, ${competitorResults.length} competitor results`
      );

      // Build source list from info + review results
      const sources: Source[] = [
        ...infoResults.map((r) => this.toSource(r)),
        ...reviewResults.map((r) => this.toSource(r)),
      ];

      // Combine content for AI analysis
      const infoContent = infoResults.map((r) => `[${r.title}]\n${r.content}`).join('\n\n');
      const reviewContent = reviewResults.map((r) => `[${r.title}]\n${r.content}`).join('\n\n');
      const combinedContent = `PRODUCT INFO:\n${infoContent}\n\nREVIEWS:\n${reviewContent}`;
      const competitorContent = competitorResults
        .map((r) => `[${r.title}]\n${r.content}`)
        .join('\n\n');

      // 5. Gemini: extract pros/cons
      logger.info('Analyzing pros and cons with Gemini...');
      const prosConsRaw = await aiService.ask(
        analyzeProsConsPrompt(product.name, combinedContent),
        SYSTEM_PROMPT
      );
      const { pros, cons } = this.parseProsConsResponse(prosConsRaw, product.name);

      // 6. Gemini: competitor analysis
      logger.info('Analyzing competitors with Gemini...');
      const competitorRaw = await aiService.ask(
        competitorPrompt(product.name, product.category, competitorContent),
        SYSTEM_PROMPT
      );
      const competitorAnalysis = this.parseCompetitorResponse(competitorRaw);

      // 7. Gemini: generate affiliate summary
      logger.info('Generating affiliate summary with Gemini...');
      const summary = await aiService.ask(
        summaryPrompt(
          product.name,
          product.category,
          pros,
          cons,
          competitorAnalysis,
          config.amazon.affiliateTag
        ),
        SYSTEM_PROMPT
      );

      // 8. Calculate confidence score
      const confidence = this.calculateConfidence(sources, pros, cons, infoResults);

      const findings: ResearchFindings = {
        product,
        specifications: this.extractSpecifications(infoResults),
        pros,
        cons,
        competitorAnalysis,
        sources,
        summary,
        confidence,
      };

      logger.info(`Research complete — confidence: ${(confidence * 100).toFixed(0)}%`);

      // 9. Store in ChromaDB
      await chromaService.storeResearch(jobId, findings, productQuery);

      // 10. Update SQLite job as completed
      databaseService.updateResearchJobStatus(jobId, 'completed', confidence);

      // 11. Request Discord approval
      logger.info('Requesting Discord approval...');
      const approvalId = randomUUID();
      databaseService.insertApprovalRecord({
        id: approvalId,
        researchJobId: jobId,
        status: 'pending',
      });

      const { approved, feedback } = await this.requestApproval(findings, approvalId);

      if (approved) {
        databaseService.updateApprovalStatus(approvalId, 'approved');
        logger.info(`Research approved for: ${product.name}`);
        return findings;
      } else {
        databaseService.updateApprovalStatus(approvalId, 'rejected', feedback);
        logger.info(
          `Research rejected for: ${product.name}${feedback ? ` — feedback: ${feedback}` : ''}`
        );
        return null;
      }
    } catch (error) {
      logger.error(`Research job ${jobId} failed:`, error);
      databaseService.updateResearchJobStatus(jobId, 'failed');
      throw error;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private buildProduct(query: string): Product {
    return {
      id: randomUUID(),
      name: query,
      category: 'Desk Equipment',
      url: `https://www.amazon.com/s?k=${encodeURIComponent(query)}&tag=${config.amazon.affiliateTag ?? ''}`,
    };
  }

  private toSource(result: SearchResult): Source {
    let hostname = '';
    try {
      hostname = new URL(result.url).hostname.replace('www.', '');
    } catch {
      hostname = result.url;
    }
    return {
      url: result.url,
      title: result.title,
      credibility: HIGH_CREDIBILITY_DOMAINS.some((d) => hostname.includes(d))
        ? 'high'
        : result.score > 0.7
        ? 'medium'
        : 'low',
      dateAccessed: new Date(),
    };
  }

  private parseProsConsResponse(
    raw: string,
    productName: string
  ): { pros: string[]; cons: string[] } {
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed.pros) && Array.isArray(parsed.cons)) {
        return { pros: parsed.pros, cons: parsed.cons };
      }
      throw new Error('Unexpected JSON shape');
    } catch {
      logger.warn(`Could not parse pros/cons JSON for "${productName}" — using fallback`);
      return {
        pros: ['Research completed — manual review required'],
        cons: ['Structured analysis parsing failed'],
      };
    }
  }

  private parseCompetitorResponse(raw: string): string[] {
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed.competitors)) {
        return parsed.competitors;
      }
      throw new Error('Unexpected JSON shape');
    } catch {
      logger.warn('Could not parse competitor JSON — using fallback');
      return ['Competitor analysis parsing failed — manual review required'];
    }
  }

  private extractSpecifications(infoResults: SearchResult[]): Record<string, string> {
    return {
      sourcesReviewed: String(infoResults.length),
      primarySource: infoResults[0]?.title ?? 'N/A',
      primarySourceUrl: infoResults[0]?.url ?? 'N/A',
    };
  }

  private calculateConfidence(
    sources: Source[],
    pros: string[],
    cons: string[],
    infoResults: SearchResult[]
  ): number {
    let score = 0.3;

    const highCred = sources.filter((s) => s.credibility === 'high').length;
    score += Math.min(highCred * 0.1, 0.3);

    if (pros.length >= 4) score += 0.1;
    if (cons.length >= 3) score += 0.1;
    if (sources.length >= 8) score += 0.05;

    const avgScore =
      infoResults.reduce((sum, r) => sum + r.score, 0) / (infoResults.length || 1);
    if (avgScore > 0.7) score += 0.05;

    return Math.min(parseFloat(score.toFixed(2)), 1.0);
  }

  private async requestApproval(
    findings: ResearchFindings,
    approvalId: string
  ): Promise<{ approved: boolean; feedback?: string }> {
    const request: ApprovalRequest = {
      id: approvalId,
      type: 'research',
      data: findings,
      status: 'pending',
      requestedAt: new Date(),
    };

    try {
      const result = await discordService.requestApproval(request);
      return { approved: result.approved, feedback: result.feedback };
    } catch (error) {
      logger.error('Discord approval request failed:', error);
      return { approved: false };
    }
  }
}

export default ContentResearcher;
