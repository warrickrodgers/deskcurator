import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

import { ReadableStream } from 'node:stream/web';
globalThis.ReadableStream = ReadableStream as any;

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
// import { DuckDuckGoSearch } from '@langchain/community/tools/duckduckgo_search';
import { AgentExecutor, createToolCallingAgent } from '@langchain/classic/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { trackTokens } from './performance.js';

interface ResearchResult {
  table: string;
  json: any;
}

const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-pro",
  apiKey: process.env.GOOGLE_API_KEY!,
});

const tools: any[] = [];

export async function research(query: string): Promise<ResearchResult> {
  const promptTemplate = ChatPromptTemplate.fromMessages([
    ['system', 'You are a research assistant. Use the provided tools to research the query.'],
    ['placeholder', '{chat_history}'],
    ['human', '{input}'],
    ['placeholder', '{agent_scratchpad}']
  ]);

  const toolAgent = createToolCallingAgent({ llm: model, tools, prompt: promptTemplate });
  const executor = AgentExecutor.fromAgentAndTools({ agent: toolAgent, tools });

  const result = await executor.invoke({
    input: `Research "${query}" and provide:
- A markdown table comparing top options with columns: Name, Rating, Feature, Affiliate Link
- JSON with structure: {"items": [{"name": "string", "rating": "number", "feature": "string", "affiliate": "string"}], "revenue": "$estimated", "persona": "target_persona"}`
  });

  const output = result.output as string;

  // Assuming output format: table\n\n\nJSON
  const parts = output.split('\n\n\n');
  let table: string;
  let json: any;

  if (parts.length >= 2) {
    const tableSection = parts[0]!;
    const jsonSection = parts[1]!;

    table = tableSection.trim();
    const jsonStr = jsonSection.trim();

    try {
      json = JSON.parse(jsonStr);
    } catch (e) {
      json = { error: 'Failed to parse JSON', raw: jsonStr };
    }
  } else {
    throw new Error('Invalid output format: expected table and JSON sections separated by \\n\\n\\n');
  }

  // Track tokens (estimate based on input/output length)
  const inputLength = result.input.length;
  const estimatedTokens = (inputLength + output.length) / 4; // rough estimate
  trackTokens(estimatedTokens);

  return { table, json };
}

// For testing
if (import.meta.url === 'file://' + process.argv[1]) {
  research('Best Pomodoro apps 2025').then(console.log);
}
