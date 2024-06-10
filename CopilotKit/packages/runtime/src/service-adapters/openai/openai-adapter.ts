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

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const { model = this.model, tools = [], eventSource } = request;

    // TODO-PROTOCOL: this is any because the message input type does not have id
    // change it.
    let messages: any[] = request.messages.map((message) => {
      return {
        role: message.role,
        content: message.content,
      };
    });

    messages = limitOpenAIMessagesToTokenCount(messages, tools, maxTokensForOpenAIModel(model));

    eventSource.stream(async (eventStream$) => {
      const stream = this.openai.beta.chat.completions.stream({
        model: model,
        stream: true,
        messages: messages as any,
        ...(tools.length > 0 && { tools }),
      });
      let mode: "function" | "message" | null = null;
      for await (const chunk of stream) {
        const toolCallFunction = chunk.choices[0].delta.tool_calls?.[0]?.function;
        const toolCallId = chunk.choices[0].delta.tool_calls?.[0]?.id;
        const content = chunk.choices[0].delta.content;

        // When switching from message to function or vice versa,
        // send the respective end event.
        if (mode === "message" && toolCallFunction) {
          mode = null;
          eventStream$.sendTextMessageEnd();
        } else if (mode === "function" && !toolCallFunction) {
          mode = null;
          eventStream$.sendToolCallEnd();
        }

        // If we send a new message type, send the appropriate start event.
        if (mode === null) {
          if (toolCallFunction) {
            mode = "function";
            eventStream$.sendToolCallStart(toolCallId, toolCallFunction!.name);
          } else if (content) {
            mode = "message";
            eventStream$.sendTextMessageStart(chunk.id);
          }
        }

        // send the content events
        if (mode === "message" && content) {
          eventStream$.sendTextMessageContent(content);
        } else if (mode === "function" && toolCallFunction.arguments) {
          eventStream$.sendToolCallArgs(toolCallFunction.arguments);
        }
      }

      // send the end events
      if (mode === "message") {
        eventStream$.sendTextMessageEnd();
      } else if (mode === "function") {
        eventStream$.sendToolCallEnd();
      }

      eventStream$.complete();
    });

    return {};
  }
}
