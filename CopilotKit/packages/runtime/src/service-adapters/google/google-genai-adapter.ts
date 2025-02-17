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

interface GoogleGenerativeAIAdapterOptions {
  /**
   * A custom Google Generative AI model to use.
   */
  model?: string;
}

export class GoogleGenerativeAIAdapter extends LangChainAdapter {
  constructor(options?: GoogleGenerativeAIAdapterOptions) {
    super({
      chainFn: async ({ messages, tools, threadId }) => {
        const model = new ChatGoogle({
          modelName: options?.model ?? "gemini-1.5-pro",
          apiVersion: "v1beta",
        }).bindTools(tools);
        return model.stream(messages, { metadata: { conversation_id: threadId } });
      },
    });
  }
}
