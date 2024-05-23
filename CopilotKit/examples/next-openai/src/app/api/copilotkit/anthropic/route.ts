import { CopilotRuntime, LangChainAdapter } from "@copilotkit/backend";
import { ChatAnthropic } from "@langchain/anthropic";

export async function POST(req: Request): Promise<Response> {
  const copilotKit = new CopilotRuntime();

  return copilotKit.response(
    req,
    new LangChainAdapter(async (forwardedProps) => {
      const model = new ChatAnthropic({
        temperature: 0.9,
        model: "claude-3-sonnet-20240229",
        // Defaults to process.env.ANTHROPIC_API_KEY,
        // apiKey: "YOUR-API-KEY",
        maxTokens: 1024,
      });

      return model.stream(forwardedProps.messages, {
        tools: LangChainAdapter.convertToolsToJsonSchema(forwardedProps.tools),
      });
    }),
  );
}
