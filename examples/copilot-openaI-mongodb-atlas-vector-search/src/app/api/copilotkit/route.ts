

import OpenAI from 'openai';
import { MongoClient } from 'mongodb';
import {posts} from "@/app/lib/data/data";


import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { NextRequest } from 'next/server';




const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MONGODB_URI = process.env.MONGODB_CONNECTION_URI;


const openai = new OpenAI({ apiKey: OPENAI_API_KEY});
const serviceAdapter = new OpenAIAdapter({ openai });


if (!OPENAI_API_KEY || !MONGODB_URI) {
  console.error('Missing required API keys or MongoDB URI.');
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI);
const database = client.db("knowledge_base");
const collection = database.collection("articles");

// Function to create vector index
const createVectorIndex = async () => {
  try {
    const index = {
      name: "vector_index",
      type: "vectorSearch",
      definition: {
        fields: [{
          type: "vector",
          numDimensions: 1536,
          path: "embedding",
          similarity: "cosine"
        }]
      }
    }

    const result = await collection.createSearchIndex(index);
    console.log(`Vector index created: ${result}`);
    
    interface SearchIndex {
      name: string;
      queryable: boolean;
    }
    let isQueryable = false;
    while (!isQueryable) {
      const cursor = collection.listSearchIndexes();
      for await (const index of cursor as unknown as SearchIndex[]) {
        if (index.name === result) {
          if (index.queryable) {
            console.log(`${result} is ready for querying`);
            isQueryable = true;
          } else {
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      }
    }
  } catch (error) {
    console.error('Error creating vector index:', error);
    throw error;
  }
};

// Function to  create and store embeddings for the data
const initializeData = async () => {
  try {
    await client.connect();
    const embeddings = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: posts.map(d => d.content)
    });

    // Store documents with embeddings
    for (let i = 0; i < posts.length; i++) {
      await collection.updateOne(
        { id: posts[i].id.toString() },
        {
          $set: {
            content: posts[i].content,
            embedding: embeddings.data[i].embedding
          }
        },
        { upsert: true }
      );
    }

    await createVectorIndex();
    console.log('success....');
  } catch (error) {
    console.error('error...', error);
    throw error;
  }
};

initializeData().catch(console.error);

//copilotkit runtime with the search functionality -- each query is converted to an embedding and then the search is performed on the vector index

const runtime = new CopilotRuntime({
  actions: () => [
    {
      name: 'FetchKnowledgebaseArticles',
      description: 'Fetch relevant knowledge base articles based on a user query',
      parameters: [
        {
          name: 'query',
          type: 'string',
          description: 'The User query for the knowledge base index search to perform',
          required: true,
        },
      ],
      handler: async ({ query }: { query: string }) => {
        try {
          const queryEmbedding = await openai.embeddings.create({
            model: "text-embedding-ada-002",
            input: query,
          });

          const database = client.db("knowledge_base");
          const collection = database.collection("articles");

          const articles = await collection.aggregate([
            {
              $vectorSearch: {
                index: "vector_index",
                queryVector: queryEmbedding.data[0].embedding,
                path: "embedding",
                numCandidates: 100,
                limit: 3
              }
            },
            {
              $project: {
                _id: 0,
                content: 1,
                score: { $meta: "vectorSearchScore" }
              }
            }
          ]).toArray();

          return { articles };
        } catch (error) {
          console.error('Error fetching knowledge base articles:', error);
          throw new Error('Failed to fetch knowledge base articles.');
        }
      },
    },
  ],
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: '/api/copilotkit',
  });

  return handleRequest(req);
};



