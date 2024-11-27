export async function getServiceAdapter(name: string) {
  switch (name) {
    case "openai":
      return getOpenAIAdapter();
    case "azure_openai":
      return getAzureOpenAIAdapter();
    case "anthropic":
      return getAnthropicAdapter();
    case "gemini":
      return getGeminiAdapter();
    case "groq":
      return getGroqAdapter();
    case "langchain_openai":
      return getLangChainOpenAIAdapter();
    case "langchain_anthropic":
      return getLangChainAnthropicAdapter();
    case "langchain_gemini":
      return getLangChainGoogleGenAIAdapter();
    default:
      throw new Error(`Service adapter "${name}" not found`);
  }
}

async function getOpenAIAdapter() {
  const { OpenAIAdapter } = await import("@copilotkit/runtime");
  return new OpenAIAdapter();
}

async function getAzureOpenAIAdapter() {
  const { OpenAIAdapter } = await import("@copilotkit/runtime");
  const { OpenAI } = await import("openai");
  const openai = new OpenAI({
    apiKey: process.env["AZURE_OPENAI_API_KEY"],
    baseURL: `https://${process.env["AZURE_OPENAI_INSTANCE"]}.openai.azure.com/openai/deployments/${process.env["AZURE_OPENAI_MODEL"]}`,
    defaultQuery: { "api-version": "2024-04-01-preview" },
    defaultHeaders: { "api-key": process.env["AZURE_OPENAI_API_KEY"] },
  });
  return new OpenAIAdapter({ openai });
}

async function getAnthropicAdapter() {
  const { AnthropicAdapter } = await import("@copilotkit/runtime");
  return new AnthropicAdapter();
}

async function getGeminiAdapter() {
  const { GoogleGenerativeAIAdapter } = await import("@copilotkit/runtime");
  return new GoogleGenerativeAIAdapter();
}

async function getGroqAdapter() {
  const { GroqAdapter } = await import("@copilotkit/runtime");
  return new GroqAdapter();
}

async function getLangChainOpenAIAdapter() {
  const { LangChainAdapter } = await import("@copilotkit/runtime");
  const { ChatOpenAI } = await import("@langchain/openai");
  return new LangChainAdapter({
    chainFn: async ({ messages, tools, threadId }) => {
      const model = new ChatOpenAI({ modelName: "gpt-4-1106-preview" }).bindTools(tools, {
        strict: true,
      });
      return model.stream(messages, { tools, metadata: { conversation_id: threadId } });
    },
  });
}

async function getLangChainAnthropicAdapter() {
  const { LangChainAdapter } = await import("@copilotkit/runtime");
  const { ChatAnthropic } = await import("@langchain/anthropic");
  return new LangChainAdapter({
    chainFn: async ({ messages, tools, threadId }) => {
      const model = new ChatAnthropic({ modelName: "claude-3-haiku-20240307" }) as any;
      return model.stream(messages, { tools, metadata: { conversation_id: threadId } });
    },
  });
}

async function getLangChainGoogleGenAIAdapter() {
  // TODO: This is now the same as `GoogleGenerativeAIAdapter` and should be removed.
  const { LangChainAdapter } = await import("@copilotkit/runtime");
  const { ChatGoogle } = await import("@langchain/google-gauth");
  return new LangChainAdapter({
    chainFn: async ({ messages, tools, threadId }) => {
      const model = new ChatGoogle({
        modelName: "gemini-1.5-pro",
        apiVersion: "v1beta",
      }).bindTools(tools);
      return model.stream(messages, { metadata: { conversation_id: threadId } });
    },
  });
}
