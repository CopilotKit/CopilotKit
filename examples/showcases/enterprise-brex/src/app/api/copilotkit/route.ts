import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import OpenAI from "openai";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "../v1/permissions";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "@langchain/core/documents";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnablePassthrough, RunnableSequence } from "@langchain/core/runnables";
import { AIMessageChunk } from "@langchain/core/messages";
import { SERVICE_NOW_BASE_URL, serviceNowApiHeaders } from "@/app/api/servicenow/[...path]/route";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import * as path from "path";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const llmAdapter = new OpenAIAdapter({
  openai,
  model: "gpt-4o",
});

export interface Article {
  short_description: string;
  text: string;
  number: string;
  sys_created_on: string;
  workflow_state: string;
}

const getKBArticlesByQuery = async (query: string): Promise<Article[] | null> => {
  const params = new URLSearchParams({
    sysparm_query: `text LIKE ${query}^ORDERBYDESCsys_created_on`,
    sysparm_limit: "5",
    sysparm_fields: "short_description,text,number,sys_created_on,workflow_state",
  });

  const response = await fetch(`${SERVICE_NOW_BASE_URL}/table/kb_knowledge?${params.toString()}`, {
    headers: serviceNowApiHeaders,
  });

  const { result } = await response.json();
  return result.length ? result : null;
};

const runtime = new CopilotRuntime({
  actions: ({ properties }) => {
    if (!PERMISSIONS.READ_MSA.includes(properties.userRole)) {
      return [];
    }
    return [
      // {
      //   name: "queryVendorMSA",
      //   description:
      //     "Query MSA documents for a specific vendor. Call this if the user has any question specific to a vendor.",
      //   parameters: [
      //     {
      //       name: "vendorName",
      //     },
      //   ],
      //   handler() {
      //     return FEDEX_MSA;
      //   },
      // },
      {
        name: "getAnswerUsingKBSystemArticles",
        description:
          "Search articles to find the correct answer. If an answer was not provided, do not attempt to provide one yourself",
        parameters: [
          {
            name: "query",
            type: "string",
            description: "The query/user issue for query result.",
          },
        ],
        handler: async ({ query }: { query: string }) => {
          const articles = await getKBArticlesByQuery(query);
          // TODO: a better answer here maybe?
          if (!articles) return "Could not fetch articles to base answer upon";

          const docs: Document[] = articles.map(
            ({ text, number, ...article }) =>
              new Document({
                pageContent: text,
                id: number,
                metadata: article,
              }),
          );
          return await performRagByDocuments(query, docs);
        },
      },
      {
        name: "answerTensaiRelatedQuestions",
        description: "Get any answer regarding Tensai.",
        parameters: [{ name: "query", type: "string", description: "The question" }],
        handler: async ({ query }: { query: string }) => {
          // Pass the File to the DocxLoader
          const loader = new DocxLoader(path.resolve(process.cwd(), "./assets/all_about_tensai.docx")); // {{ edit_6 }}
          const docs = await loader.load();

          return await performRagByDocuments(query, docs);
        },
      },
    ];
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: llmAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};

export async function performRagByDocuments(userQuery: string, docs: Document[]): Promise<AIMessageChunk> {
  if (!docs.length) return new AIMessageChunk("Answer cannot be provided");
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const splits = await textSplitter.splitDocuments(docs);

  // Step 2: Create embeddings for the chunks
  const embeddings = new OpenAIEmbeddings();
  const vectorStore = await MemoryVectorStore.fromDocuments(splits, embeddings);
  // Step 3: Create a retriever
  const retriever = vectorStore.asRetriever();
  // Step 4: Set up the language model
  const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0 });

  // Step 5: Create a prompt template
  const promptTemplate = ChatPromptTemplate.fromMessages([
    [
      "system",
      `
      You are an AI language model with comprehensive knowledge about Tensai, a cutting-edge AI system designed to enhance information retrieval and operational efficiency across various domains.
      Your task is to provide clear, accurate, and short answers to questions about Tensai.
      You shall rely on the context provided in order to provide an answer.
      You have no other knowledge of Tensai other than what's in the provided context.
      
      The provided context:
      {context}
    `,
    ],
    ["human", "{question}"],
  ]);

  // Step 6: Create the RAG chain
  const ragChain = RunnableSequence.from([
    {
      context: retriever.pipe((input) => input), // Retrieve relevant documents
      question: new RunnablePassthrough(), // Pass the user's question
    },
    promptTemplate,
    llm,
  ]);

  return await ragChain.invoke(userQuery);
}
