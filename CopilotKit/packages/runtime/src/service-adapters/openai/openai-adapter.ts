/**
 * Copilot Runtime adapter for OpenAI.
 *
 * ## Example
 *
 * ```ts
 * import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/runtime";
 * import OpenAI from "openai";
 *
 * const copilotKit = new CopilotRuntime();
 *
 * const openai = new OpenAI({
 *   organization: "<your-organization-id>", // optional
 *   apiKey: "<your-api-key>",
 * });
 *
 * const serviceAdapter = new OpenAIAdapter({ openai });
 *
 * return copilotKit.streamHttpServerResponse(req, res, serviceAdapter);
 * ```
 */
import OpenAI from "openai";
import {
  CopilotServiceAdapter,
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../service-adapter";
import {
  convertActionInputToOpenAITool,
  convertMessageToOpenAIMessage,
  limitMessagesToTokenCount,
} from "./utils";
import { randomId } from "@copilotkit/shared";

const DEFAULT_MODEL = "gpt-4o";

export interface OpenAIAdapterParams {
  /**
   * An optional OpenAI instance to use.  If not provided, a new instance will be
   * created.
   */
  openai?: OpenAI;

  /**
   * The model to use.
   */
  model?: string;

  /**
   * Whether to disable parallel tool calls.
   * You can disable parallel tool calls to force the model to execute tool calls sequentially.
   * This is useful if you want to execute tool calls in a specific order so that the state changes
   * introduced by one tool call are visible to the next tool call. (i.e. new actions or readables)
   *
   * @default false
   */
  disableParallelToolCalls?: boolean;
}

export class OpenAIAdapter implements CopilotServiceAdapter {
  private model: string = DEFAULT_MODEL;

  private disableParallelToolCalls: boolean = false;
  private _openai: OpenAI;
  public get openai(): OpenAI {
    return this._openai;
  }

  constructor(params?: OpenAIAdapterParams) {
    this._openai = params?.openai || new OpenAI({});
    if (params?.model) {
      this.model = params.model;
    }
    this.disableParallelToolCalls = params?.disableParallelToolCalls || false;
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const {
      threadId,
      model = this.model,
      messages,
      actions,
      eventSource,
      forwardedParameters,
    } = request;
    const tools = actions.map(convertActionInputToOpenAITool);

    let openaiMessages = messages.map(convertMessageToOpenAIMessage);
    openaiMessages = limitMessagesToTokenCount(openaiMessages, tools, model);

    let toolChoice: any = forwardedParameters?.toolChoice;
    if (forwardedParameters?.toolChoice === "function") {
      toolChoice = {
        type: "function",
        function: { name: forwardedParameters.toolChoiceFunctionName },
      };
    }

    const stream = this.openai.beta.chat.completions.stream({
      model: model,
      stream: true,
      messages: openaiMessages,
      ...(tools.length > 0 && { tools }),
      ...(forwardedParameters?.maxTokens && { max_tokens: forwardedParameters.maxTokens }),
      ...(forwardedParameters?.stop && { stop: forwardedParameters.stop }),
      ...(toolChoice && { tool_choice: toolChoice }),
      ...(this.disableParallelToolCalls && { parallel_tool_calls: false }),
    });

    eventSource.stream(async (eventStream$) => {
      let mode: "function" | "message" | null = null;
      for await (const chunk of stream) {
        const toolCall = chunk.choices[0].delta.tool_calls?.[0];
        const content = chunk.choices[0].delta.content;

        // When switching from message to function or vice versa,
        // send the respective end event.
        // If toolCall?.id is defined, it means a new tool call starts.
        if (mode === "message" && toolCall?.id) {
          mode = null;
          eventStream$.sendTextMessageEnd();
        } else if (mode === "function" && (toolCall === undefined || toolCall?.id)) {
          mode = null;
          eventStream$.sendActionExecutionEnd();
        }

        // If we send a new message type, send the appropriate start event.
        if (mode === null) {
          if (toolCall?.id) {
            mode = "function";
            eventStream$.sendActionExecutionStart(toolCall!.id, toolCall!.function!.name);
          } else if (content) {
            mode = "message";
            eventStream$.sendTextMessageStart(chunk.id);
          }
        }

        // send the content events
        if (mode === "message" && content) {
          eventStream$.sendTextMessageContent(content);
        } else if (mode === "function" && toolCall?.function?.arguments) {
          eventStream$.sendActionExecutionArgs(toolCall.function.arguments);
        }
      }

      // send the end events
      if (mode === "message") {
        eventStream$.sendTextMessageEnd();
      } else if (mode === "function") {
        eventStream$.sendActionExecutionEnd();
      }

      eventStream$.complete();
    });

    return {
      threadId: threadId || randomId(),
    };
  }
}
