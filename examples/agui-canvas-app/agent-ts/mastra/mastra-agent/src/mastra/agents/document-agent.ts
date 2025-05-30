import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
// import { weatherTool } from '../tools/document-tool';

export const documentAgent = new Agent({
  name: 'Document Agent',
  instructions: `
      You are a helpful document assistant that generates short document on a given topic.

      Your primary function is to generate short document on a given topic. When responding:
      - The response should have a title, introduction, body and conclusion
      - Keep responses concise but informative
`,
  model: openai('gpt-4o-mini'),
  tools: { },
  memory: new Memory({
    storage: new LibSQLStore({
      url: 'file:../mastra.db', // path is relative to the .mastra/output directory
    }),
  }),
});

export const summaryAgent = new Agent({
  name: 'Summary Agent',
  instructions: `
    You are a helpful document assistant that summarizes the generated documents.

    Your primary function is to summarize the generated documents. When responding:
    - The response should be maximum 3 sentences.
    - Always have an intent that here is the document on the topic that have been generated.
  `,
  model: openai('gpt-4o-mini'),
  tools: { },
  memory: new Memory({
    storage: new LibSQLStore({
      url: 'file:../mastra.db', // path is relative to the .mastra/output directory
    }),
  }),
});
