import { ChromaClient, Collection } from 'chromadb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env';
import logger from '../utils/logger';
import { ResearchFindings } from '../types';

const COLLECTION_NAME = 'product_research';
const SIMILARITY_THRESHOLD = 0.85;
const EMBEDDING_MODEL = 'text-embedding-004';

export class ChromaService {
  private client: ChromaClient;
  private collection: Collection | null = null;
  private embeddingClient: GoogleGenerativeAI;

  constructor() {
    this.client = new ChromaClient({ path: config.chromadb.url });
    this.embeddingClient = new GoogleGenerativeAI(config.ai.gemini.apiKey);
  }

  async initialize(): Promise<void> {
    try {
      this.collection = await this.client.getOrCreateCollection({
        name: COLLECTION_NAME,
        metadata: { 'hnsw:space': 'cosine' },
      });
      logger.info(`ChromaDB collection "${COLLECTION_NAME}" ready`);
    } catch (error) {
      logger.error('ChromaDB initialization failed:', error);
      throw error;
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const model = this.embeddingClient.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(text);
    return result.embedding.values;
  }

  private buildEmbeddingText(productName: string, category: string, query: string): string {
    return `Product: ${productName}. Category: ${category}. Query: ${query}`;
  }

  /**
   * Returns true if research with >= 0.85 cosine similarity already exists.
   * Fails open — returns false if ChromaDB is unavailable.
   */
  async hasSimilarResearch(
    productName: string,
    category: string,
    searchQuery: string
  ): Promise<boolean> {
    if (!this.collection) throw new Error('ChromaService not initialized');

    try {
      const text = this.buildEmbeddingText(productName, category, searchQuery);
      const embedding = await this.generateEmbedding(text);

      const results = await this.collection.query({
        queryEmbeddings: [embedding],
        nResults: 1,
      });

      const distances = results.distances?.[0];
      if (!distances || distances.length === 0 || distances[0] == null) {
        return false;
      }

      // ChromaDB cosine space returns distance (0=identical, 1=orthogonal).
      // similarity = 1 - distance
      const similarity = 1 - (distances[0] as number);
      logger.debug(
        `ChromaDB similarity for "${productName}": ${similarity.toFixed(3)} (threshold: ${SIMILARITY_THRESHOLD})`
      );
      return similarity >= SIMILARITY_THRESHOLD;
    } catch (error) {
      logger.warn('ChromaDB similarity check failed — proceeding with research:', error);
      return false;
    }
  }

  /**
   * Store completed research as a vector embedding for future deduplication.
   */
  async storeResearch(
    jobId: string,
    findings: ResearchFindings,
    searchQuery: string
  ): Promise<void> {
    if (!this.collection) throw new Error('ChromaService not initialized');

    try {
      const text = this.buildEmbeddingText(
        findings.product.name,
        findings.product.category,
        searchQuery
      );
      const embedding = await this.generateEmbedding(text);

      const document = JSON.stringify({
        productName: findings.product.name,
        category: findings.product.category,
        summary: findings.summary,
        confidence: findings.confidence,
        searchQuery,
      });

      await this.collection.upsert({
        ids: [jobId],
        embeddings: [embedding],
        documents: [document],
        metadatas: [
          {
            productName: findings.product.name,
            category: findings.product.category,
            confidence: findings.confidence,
            searchQuery,
            researchedAt: new Date().toISOString(),
          },
        ],
      });

      logger.info(`Research stored in ChromaDB (job: ${jobId})`);
    } catch (error) {
      logger.error('Failed to store research in ChromaDB:', error);
      throw error;
    }
  }
}

export const chromaService = new ChromaService();
