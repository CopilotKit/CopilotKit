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
        envVarName: "OPENAI_API_KEY",
        adapterImport: "OpenAIAdapter",
        adapterSetup: 'const serviceAdapter = new OpenAIAdapter();'
    },
    "azure": {
        id: "azure",
        title: "Azure OpenAI",
        icon: '/icons/azure.png',
        packageName: "openai",
        envVarName: "AZURE_OPENAI_API_KEY",
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
    "anthropic": {
        id: "anthropic",
        title: "Anthropic (Claude)",
        icon: '/icons/anthropic.png',
        envVarName: "ANTHROPIC_API_KEY",
        adapterImport: "AnthropicAdapter",
        adapterSetup: 'const serviceAdapter = new AnthropicAdapter();'
    },
    "groq": {
        id: "groq",
        title: "Groq",
        icon: '/icons/groq.png',
        envVarName: "GROQ_API_KEY",
        adapterImport: "GroqAdapter",
        adapterSetup: 'const serviceAdapter = new GroqAdapter({ model: "<model-name>" });'
    },
    "google": {
        id: "google",
        title: "Google Generative AI (Gemini)",
        icon: '/icons/google.png',
        envVarName: "GOOGLE_API_KEY",
        adapterImport: "GoogleGenerativeAIAdapter",
        adapterSetup: 'const serviceAdapter = new GoogleGenerativeAIAdapter({ model: <optional model choice> });'
    },
    "langchain": {
        id: 'langchain',
        title: 'LangChain (any model)',
        icon: '/icons/langchain.png',
        packageName: "@langchain/openai",
        envVarName: "OPENAI_API_KEY",
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
    },
    "openai-assistants": {
        id: "openai-assistants",
        title: "OpenAI Assistants API",
        icon: '/icons/openai.png',
        packageName: "openai",
        envVarName: "OPENAI_API_KEY",
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
    "empty": {
        id: "empty",
        title: "Empty Adapter (CoAgents Only)",
        icon: '/icons/empty.svg',
        adapterImport: "EmptyAdapter",
        adapterSetup: 'const serviceAdapter = new EmptyAdapter();'
    },
};
