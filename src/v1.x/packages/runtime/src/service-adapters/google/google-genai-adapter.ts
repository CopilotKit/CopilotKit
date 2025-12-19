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
 * return new GoogleGenerativeAIAdapter({ model: "gemini-2.5-flash", apiVersion: "v1" });
 * ```
 */
import { LangChainAdapter } from "../langchain/langchain-adapter";

interface GoogleGenerativeAIAdapterOptions {
  /**
   * A custom Google Generative AI model to use.
   */
  model?: string;
  /**
   * The API version to use (e.g. "v1" or "v1beta"). Defaults to "v1".
   */
  apiVersion?: "v1" | "v1beta";
  /**
   * The API key to use.
   */
  apiKey?: string;
}

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_API_VERSION: GoogleGenerativeAIAdapterOptions["apiVersion"] = "v1";
let hasWarnedDefaultGoogleModel = false;

export class GoogleGenerativeAIAdapter extends LangChainAdapter {
  public provider = "google";
  public model: string = DEFAULT_MODEL;

  constructor(options?: GoogleGenerativeAIAdapterOptions) {
    if (!hasWarnedDefaultGoogleModel && !options?.model && !options?.apiVersion) {
      console.warn(
        `You are using the GoogleGenerativeAIAdapter without explicitly setting a model or apiVersion. ` +
          `CopilotKit will default to apiVersion="v1" and model="${DEFAULT_MODEL}". ` +
          `To silence this warning, pass model and apiVersion when constructing the adapter.`,
      );
      hasWarnedDefaultGoogleModel = true;
    }

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

        this.model = options?.model ?? DEFAULT_MODEL;
        const model = new ChatGoogle({
          apiKey: options?.apiKey ?? process.env.GOOGLE_API_KEY,
          modelName: this.model,
          apiVersion: options?.apiVersion ?? DEFAULT_API_VERSION,
        }).bindTools(tools);

        return model.stream(filteredMessages, { metadata: { conversation_id: threadId } });
      },
    });
  }
}
