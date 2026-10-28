// The LLM providers the legacy (v1) self-hosting snippets let the reader pick
// from. Each value fills a `{{key}}` placeholder in those snippets' code.
export interface ProviderConfig {
  id: string;
  title: string;
  packageName?: string;
  envVarName?: string;
  envVarSecret?: string;
  envVarAccess?: string;
  envVarToken?: string;
  adapterImport: string;
  extraImports: string;
  clientSetup: string;
  adapterSetup: string;
}

export const quickStartProviders: ProviderConfig[] = [
  {
    id: "openai",
    title: "OpenAI",
    packageName: "openai",
    envVarName: "OPENAI_API_KEY",
    adapterImport: "OpenAIAdapter",
    extraImports: "import OpenAI from 'openai';",
    clientSetup: "const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });",
    adapterSetup: "const serviceAdapter = new OpenAIAdapter({ openai });",
  },
  {
    id: "anthropic",
    title: "Anthropic",
    packageName: "@anthropic-ai/sdk",
    envVarName: "ANTHROPIC_API_KEY",
    adapterImport: "AnthropicAdapter",
    extraImports: "import Anthropic from '@anthropic-ai/sdk';",
    clientSetup:
      "const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });",
    adapterSetup: "const serviceAdapter = new AnthropicAdapter({ anthropic });",
  },
  {
    id: "gemini",
    title: "Google Gemini",
    packageName: "@langchain/google-gauth",
    envVarName: "GOOGLE_API_KEY",
    adapterImport: "GoogleGenerativeAIAdapter",
    extraImports: "",
    clientSetup: "",
    adapterSetup: "const serviceAdapter = new GoogleGenerativeAIAdapter();",
  },
  {
    id: "groq",
    title: "Groq",
    packageName: "groq-sdk",
    envVarName: "GROQ_API_KEY",
    adapterImport: "GroqAdapter",
    extraImports: "import { Groq } from 'groq-sdk';",
    clientSetup: "const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });",
    adapterSetup: "const serviceAdapter = new GroqAdapter({ groq });",
  },
  {
    id: "langchain",
    title: "LangChain",
    packageName: "@langchain/openai",
    envVarName: "OPENAI_API_KEY",
    adapterImport: "LangChainAdapter",
    extraImports: "import { ChatOpenAI } from '@langchain/openai';",
    clientSetup:
      "const model = new ChatOpenAI({ model: 'gpt-4o', apiKey: process.env.OPENAI_API_KEY });",
    adapterSetup: `const serviceAdapter = new LangChainAdapter({
  chainFn: async ({ messages, tools }) => model.bindTools(tools).stream(messages),
});`,
  },
  {
    id: "openai-assistants",
    title: "OpenAI Assistants",
    packageName: "openai",
    envVarName: "OPENAI_API_KEY",
    adapterImport: "OpenAIAssistantAdapter",
    extraImports: "import OpenAI from 'openai';",
    clientSetup: "const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });",
    adapterSetup:
      "const serviceAdapter = new OpenAIAssistantAdapter({ openai, assistantId: '<your-assistant-id>' });",
  },
  {
    id: "bedrock",
    title: "Amazon Bedrock",
    envVarSecret: "AWS_SECRET_ACCESS_KEY",
    envVarAccess: "AWS_ACCESS_KEY_ID",
    envVarToken: "AWS_SESSION_TOKEN",
    adapterImport: "BedrockAdapter",
    extraImports: "",
    clientSetup: "",
    adapterSetup: `const serviceAdapter = new BedrockAdapter({
  model: 'amazon.nova-lite-v1:0',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});`,
  },
  {
    id: "empty",
    title: "Empty adapter",
    adapterImport: "ExperimentalEmptyAdapter",
    extraImports: "",
    clientSetup: "",
    adapterSetup: "const serviceAdapter = new ExperimentalEmptyAdapter();",
  },
];
