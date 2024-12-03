export type ProviderDefinition = {
    id: string;
    title: string;
} & { [key: string]: any };
export type ProvidersConfig = {
    [key: string]: ProviderDefinition;
}

export const quickStartProviders: ProvidersConfig = {
    "openai": {
        id: "openai",
        title: "OpenAI",
        icon: '/icons/openai.png',
        packageName: "openai",
        endVarName: "OPENAI_API_KEY",
        adapterImport: "OpenAIAdapter",
        extraImports: [
            'import OpenAI from \'openai\';'
        ],
        clientSetup: 'const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });',
        adapterSetup: 'const serviceAdapter = new OpenAIAdapter({ openai });'
    },
    "openai-assistants": {
        id: "openai-assistants",
        title: "OpenAI Assistants",
        icon: '/icons/openai.png',
        packageName: "openai",
        endVarName: "OPENAI_API_KEY",
        adapterImport: "OpenAIAssistantAdapter",
        extraImports: [
            'import OpenAI from \'openai\';'
        ],
        clientSetup: `
        const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: "<your-organization-id>"
});
        `,
        adapterSetup: `
        new OpenAIAssistantAdapter({
  openai,
  assistantId: "<your-assistant-id>",
  codeInterpreterEnabled: true,
  fileSearchEnabled: true,
});
        `
    },
    "anthropic": {
        id: "anthropic",
        title: "Anthropic",
        icon: '/icons/anthropic.png',
        packageName: "@anthropic-ai/sdk",
        endVarName: "ANTHROPIC_API_KEY",
        adapterImport: "AnthropicAdapter",
        extraImports: `
            import Anthropic from "@anthropic-ai/sdk";
        `,
        clientSetup: 'const anthropic = new Anthropic({apiKey: "<your-api-key>"});',
        adapterSetup: 'const serviceAdapter = new AnthropicAdapter({ anthropic });'
    },
    "azure": {
        id: "azure",
        title: "Azure OpenAI",
        icon: '/icons/azure.png',
        packageName: "openai",
        endVarName: "AZURE_OPENAI_API_KEY",
        adapterImport: "OpenAIAdapter",
        extraImports: `
            import OpenAI from 'openai';
        `,
        clientSetup: `const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: 'https://<your instance name>.openai.azure.com/openai/deployments/<your model>',
  defaultQuery: { "api-version": "2024-04-01-preview" },
  defaultHeaders: { "api-key": apiKey },
});`,
        adapterSetup: 'const serviceAdapter = new OpenAIAdapter({ openai });'
    },
    "google": {
        id: "google",
        title: "Google Generative AI",
        icon: '/icons/google.png',
        endVarName: "GOOGLE_API_KEY",
        adapterImport: "GoogleGenerativeAIAdapter",
        adapterSetup: 'const serviceAdapter = new GoogleGenerativeAIAdapter({ model: <optional model choice> });'
    },
    "groq": {
        id: "groq",
        title: "Groq",
        icon: '/icons/groq.png',
        packageName: "groq-sdk",
        endVarName: "GROQ_API_KEY",
        adapterImport: "GroqAdapter",
        extraImports: [
            'import { Groq } from \'groq-sdk\';'
        ],
        clientSetup: 'const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });',
        adapterSetup: 'const serviceAdapter = new GroqAdapter({ groq, model: "<model-name>" });'
    },
    "langchain": {
        id: 'langchain',
        title: 'LangChain',
        icon: '/icons/langchain.png',
        packageName: "@langchain/openai",
        endVarName: "OPENAI_API_KEY",
        adapterImport: "LangChainAdapter",
        extraImports: `
            import { ChatOpenAI } from "@langchain/openai";
        `,
        clientSetup: 'const model = new ChatOpenAI({ model: "gpt-4o", apiKey: process.env.OPENAI_API_KEY });',
        adapterSetup: `
        const serviceAdapter = new LangChainAdapter({
    chainFn: async ({ messages, tools }) => {
    return model.bindTools(tools).stream(messages);
    // or optionally enable strict mode
    // return model.bindTools(tools, { strict: true }).stream(messages);
  }
});`
    }
};
