export async function getServiceAdapter(name: string) {
  switch (name) {
    case "openai":
      const { OpenAIAdapter } = await import("@copilotkit/runtime");
      return new OpenAIAdapter();
    case "anthropic":
      const { AnthropicAdapter } = await import("@copilotkit/runtime");
      return new AnthropicAdapter();
    case "gemini":
      const { GoogleGenerativeAIAdapter } = await import("@copilotkit/runtime");
      return new GoogleGenerativeAIAdapter();
    case "langchain":
      const { LangChainAdapter } = await import("@copilotkit/runtime");
      const { ChatOpenAI } = await import("@langchain/openai");
      return new LangChainAdapter({
        chainFn: async ({ messages, tools }) => {
          const model = new ChatOpenAI({ modelName: "gpt-4-1106-preview" });
          return model.stream(messages, { tools });
        },
      });
    case "groq":
      const { GroqAdapter } = await import("@copilotkit/runtime");
      return new GroqAdapter();
    default:
      throw new Error(`Service adapter "${name}" not found`);
  }
}
