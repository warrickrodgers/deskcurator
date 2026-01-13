export interface Product {
  id: string;
  name: string;
  category: string;
  price?: number;
  url: string;
  affiliateLink?: string;
}

export interface ResearchFindings {
  product: Product;
  specifications: Record<string, any>;
  pros: string[];
  cons: string[];
  competitorAnalysis: string[];
  sources: Source[];
  summary: string;
  confidence: number;
}

export interface Source {
  url: string;
  title: string;
  credibility: 'high' | 'medium' | 'low';
  dateAccessed: Date;
}

export interface ApprovalRequest {
  id: string;
  type: 'research' | 'content' | 'product';
  data: ResearchFindings | string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: Date;
  respondedAt?: Date;
}

export interface AgentConfig {
  name: string;
  role: string;
  enabled: boolean;
}