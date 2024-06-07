/**
 * CopilotRuntime Adapter for OpenAI.
 *
 * <RequestExample>
 * ```jsx CopilotRuntime Example
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(req, new OpenAIAdapter());
 * ```
 * </RequestExample>
 *
 * You can easily set the model to use by passing it to the constructor.
 * ```jsx
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(
 *   req,
 *   new OpenAIAdapter({ model: "gpt-4o" }),
 * );
 * ```
 *
 * To use your custom OpenAI instance, pass the `openai` property.
 * ```jsx
 * const openai = new OpenAI({
 *   organization: "your-organization-id",
 *   apiKey: "your-api-key"
 * });
 *
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(
 *   req,
 *   new OpenAIAdapter({ openai }),
 * );
 * ```
 *
 */
import OpenAI from "openai";
import {
  CopilotKitResponse,
  CopilotServiceAdapter,
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../service-adapter";
import { limitOpenAIMessagesToTokenCount, maxTokensForOpenAIModel } from "../../utils/openai";

const DEFAULT_MODEL = "gpt-4o";

export interface OpenAIAdapterParams {
  /**
   * An optional OpenAI instance to use.
   */
  openai?: OpenAI;

  /**
   * The model to use.
   */
  model?: string;
}

export class OpenAIAdapter implements CopilotServiceAdapter {
  private model: string = DEFAULT_MODEL;

  private _openai: OpenAI;
  public get openai(): OpenAI {
    return this._openai;
  }

  constructor(params?: OpenAIAdapterParams) {
    this._openai = params?.openai || new OpenAI({});
    if (params?.model) {
      this.model = params.model;
    }
  }

  process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const model = request.model || this.model;
    const tools = request.tools || [];

    let messages: any[] = request.messages.map((message) => {
      return {
        role: message.role,
        content: message.content,
      };
    });

    messages = limitOpenAIMessagesToTokenCount(messages, tools, maxTokensForOpenAIModel(model));

    return new Promise((resolve, reject) => {
      const stream = this.openai.beta.chat.completions.stream({
        model: model,
        stream: true,
        messages: messages as any,
        ...(tools.length > 0 && { tools }),
      });
      stream.on("error", (error) => {
        reject(error); // Reject the promise with the error
      });
      stream.on("connect", () => {
        resolve({ stream: stream.toReadableStream() });
      });
    });
  }
}
