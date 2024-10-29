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
 * const serviceAdapter = new GoogleGenerativeAIAdapter({ model: "gemini-1.5-pro" });
 *
 * return copilotKit.streamHttpServerResponse(req, res, serviceAdapter);
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
      chainFn: async ({ messages, tools }) => {
        const model = new ChatGoogle({
          modelName: options?.model ?? "gemini-1.5-pro",
          apiVersion: "v1beta",
        }).bindTools(tools);
        return model.stream(messages);
      },
    });
  }
}
