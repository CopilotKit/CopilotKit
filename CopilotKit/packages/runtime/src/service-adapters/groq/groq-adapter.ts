/**
 * Copilot Runtime adapter for Groq.
 *
 * ## Example
 *
 * ```ts
 * import { CopilotRuntime, GroqAdapter } from "@copilotkit/runtime";
 * import { Groq } from "groq-sdk";
 *
 * const groq = new Groq({ apiKey: process.env["GROQ_API_KEY"] });
 *
 * const copilotKit = new CopilotRuntime();
 *
 * const serviceAdapter = new GroqAdapter({ groq, model: "<model-name>" });
 *
 * return copilotKit.streamHttpServerResponse(req, res, serviceAdapter);
 * ```
 */
import { Groq } from "groq-sdk";
import {
  CopilotServiceAdapter,
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../service-adapter";
import {
  convertActionInputToOpenAITool,
  convertMessageToOpenAIMessage,
  limitMessagesToTokenCount,
} from "../openai/utils";
import { randomId } from "@copilotkit/shared";

const DEFAULT_MODEL = "llama3-groq-70b-8192-tool-use-preview";

export interface GroqAdapterParams {
  /**
   * An optional Groq instance to use.
   */
  groq?: Groq;

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

export class GroqAdapter implements CopilotServiceAdapter {
  private model: string = DEFAULT_MODEL;

  private disableParallelToolCalls: boolean = false;
  private _groq: Groq;
  public get groq(): Groq {
    return this._groq;
  }

  constructor(params?: GroqAdapterParams) {
    this._groq = params?.groq || new Groq({});
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
    const stream = await this.groq.chat.completions.create({
      model: model,
      stream: true,
      messages: openaiMessages,
      ...(tools.length > 0 && { tools }),
      ...(forwardedParameters?.maxTokens && {
        max_tokens: forwardedParameters.maxTokens,
      }),
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
