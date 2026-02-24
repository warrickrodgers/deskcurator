import { tavily } from '@tavily/core';
import config from '../config/env';
import logger from '../utils/logger';

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate?: string;
}

export class SearchService {
  private client: ReturnType<typeof tavily>;

  constructor() {
    this.client = tavily({ apiKey: config.tavily.apiKey });
    logger.info('SearchService (Tavily) initialized');
  }

  async searchProductInfo(productName: string): Promise<SearchResult[]> {
    try {
      const query = `${productName} specifications features review`;
      logger.debug(`Tavily search [info]: "${query}"`);

      const response = await this.client.search(query, {
        searchDepth: 'advanced',
        maxResults: 8,
      });

      return this.normalize(response.results);
    } catch (error) {
      logger.error('Tavily product info search failed:', error);
      throw error;
    }
  }

  async searchProductReviews(productName: string): Promise<SearchResult[]> {
    try {
      const query = `${productName} user reviews pros cons honest opinion`;
      logger.debug(`Tavily search [reviews]: "${query}"`);

      const response = await this.client.search(query, {
        searchDepth: 'advanced',
        maxResults: 7,
      });

      return this.normalize(response.results);
    } catch (error) {
      logger.error('Tavily reviews search failed:', error);
      throw error;
    }
  }

  async searchCompetitors(productName: string, category: string): Promise<SearchResult[]> {
    try {
      const query = `best ${category} alternatives to ${productName} comparison`;
      logger.debug(`Tavily search [competitors]: "${query}"`);

      const response = await this.client.search(query, {
        searchDepth: 'basic',
        maxResults: 5,
      });

      return this.normalize(response.results);
    } catch (error) {
      logger.error('Tavily competitor search failed:', error);
      throw error;
    }
  }

  private normalize(
    results: Array<{ title: string; url: string; content: string; score: number; publishedDate?: string }>
  ): SearchResult[] {
    return results.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
      publishedDate: r.publishedDate,
    }));
  }
}

export const searchService = new SearchService();
