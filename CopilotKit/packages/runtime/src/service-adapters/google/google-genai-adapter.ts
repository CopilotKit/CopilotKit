/**
 * Copilot Runtime adapter for Google Generative AI (e.g. Gemini).
 *
 * ## Example
 *
 * ```ts
 * import { CopilotRuntime, GoogleGenerativeAIAdapter } from "@copilotkit/runtime";
 * const { GoogleGenerativeAI } = require("@google/generative-ai");
 *
 * const genAI = new GoogleGenerativeAI(process.env["GOOGLE_API_KEY"]);
 *
 * const copilotKit = new CopilotRuntime();
 *
 * return new GoogleGenerativeAIAdapter({ model: "gemini-1.5-pro" });
 * ```
 */
import { LangChainAdapter } from "../langchain/langchain-adapter";

interface GoogleGenerativeAIAdapterOptions {
  /**
   * A custom Google Generative AI model to use.
   */
  model?: string;
  /**
   * The API key to use.
   */
  apiKey?: string;
}

const DEFAULT_MODEL = "gemini-1.5-pro";

export class GoogleGenerativeAIAdapter extends LangChainAdapter {
  public provider = "google";
  public model: string = DEFAULT_MODEL;

  constructor(options?: GoogleGenerativeAIAdapterOptions) {
    super({
      chainFn: async ({ messages, tools, threadId }) => {
        // Lazy require for optional peer dependencies
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { ChatGoogle } = require("@langchain/google-gauth");
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { AIMessage } = require("@langchain/core/messages");

        // Filter out empty assistant messages to prevent Gemini validation errors
        // Gemini specifically rejects conversations containing AIMessages with empty content
        const filteredMessages = messages.filter((message) => {
          // Keep all non-AI messages (HumanMessage, SystemMessage, ToolMessage, etc.)
          if (!(message instanceof AIMessage)) {
            return true;
          }

          // For AIMessages, only keep those with non-empty content
          // Also keep AIMessages with tool_calls even if content is empty
          const aiMsg = message as any;
          return (
            (aiMsg.content && String(aiMsg.content).trim().length > 0) ||
            (aiMsg.tool_calls && aiMsg.tool_calls.length > 0)
          );
        });

        this.model = options?.model ?? "gemini-1.5-pro";
        const model = new ChatGoogle({
          apiKey: options?.apiKey ?? process.env.GOOGLE_API_KEY,
          modelName: this.model,
          apiVersion: "v1beta",
        }).bindTools(tools);

        return model.stream(filteredMessages, { metadata: { conversation_id: threadId } });
      },
    });
  }
}
