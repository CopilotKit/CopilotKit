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
import { ChatGoogle } from "@langchain/google-gauth";
import { LangChainAdapter } from "../langchain/langchain-adapter";
import { AIMessage } from "@langchain/core/messages";

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

export class GoogleGenerativeAIAdapter extends LangChainAdapter {
  constructor(options?: GoogleGenerativeAIAdapterOptions) {
    super({
      chainFn: async ({ messages, tools, threadId }) => {
        // Filter out empty assistant messages to prevent Gemini validation errors
        // Gemini specifically rejects conversations containing AIMessages with empty content
        const filteredMessages = messages.filter((message) => {
          // Keep all non-AI messages (HumanMessage, SystemMessage, ToolMessage, etc.)
          if (!(message instanceof AIMessage)) {
            return true;
          }

          // For AIMessages, only keep those with non-empty content
          // Also keep AIMessages with tool_calls even if content is empty
          return (
            (message.content && String(message.content).trim().length > 0) ||
            (message.tool_calls && message.tool_calls.length > 0)
          );
        });

        const model = new ChatGoogle({
          apiKey: options?.apiKey ?? process.env.GOOGLE_API_KEY,
          modelName: options?.model ?? "gemini-1.5-pro",
          apiVersion: "v1beta",
        }).bindTools(tools);

        return model.stream(filteredMessages, { metadata: { conversation_id: threadId } });
      },
    });
  }
}
