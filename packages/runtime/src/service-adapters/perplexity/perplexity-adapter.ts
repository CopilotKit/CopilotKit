/**
 * Copilot Runtime adapter for Perplexity (Agent API).
 *
 * Wraps the official `openai` SDK pointed at `https://api.perplexity.ai`,
 * which exposes an OpenAI-compatible chat completions endpoint.
 *
 * ## Example
 *
 * ```ts
 * import { CopilotRuntime, PerplexityAdapter } from "@copilotkit/runtime";
 * import OpenAI from "openai";
 *
 * const perplexity = new OpenAI({
 *   apiKey: process.env["PERPLEXITY_API_KEY"],
 *   baseURL: "https://api.perplexity.ai",
 * });
 *
 * const copilotKit = new CopilotRuntime();
 *
 * return new PerplexityAdapter({ perplexity, model: "sonar-pro" });
 * ```
 */
import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type OpenAI from "openai";
import Openai from "openai";
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
import { randomUUID } from "@copilotkit/shared";
import { convertServiceAdapterError, getSdkClientOptions } from "../shared";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageJson = require("../../../package.json");

const DEFAULT_MODEL = "sonar-pro";
const DEFAULT_BASE_URL = "https://api.perplexity.ai";
const ATTRIBUTION_HEADER = "X-Pplx-Integration";
const ATTRIBUTION_VALUE = `copilotkit/${packageJson.version}`;

export interface PerplexityAdapterParams {
  /**
   * An optional `OpenAI` SDK instance pre-configured for Perplexity. If
   * provided, its `baseURL` and `defaultHeaders` are used as-is. If not
   * provided, a new instance is created targeting `https://api.perplexity.ai`
   * with the `PERPLEXITY_API_KEY` environment variable.
   */
  perplexity?: OpenAI;

  /**
   * The model to use.
   *
   * @default "sonar-pro"
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

export class PerplexityAdapter implements CopilotServiceAdapter {
  public model: string = DEFAULT_MODEL;
  public provider = "perplexity";

  private disableParallelToolCalls: boolean = false;
  private _perplexity: OpenAI;
  public get perplexity(): OpenAI {
    return this._perplexity;
  }
  public get name() {
    return "PerplexityAdapter";
  }

  constructor(params?: PerplexityAdapterParams) {
    if (params?.perplexity) {
      this._perplexity = params.perplexity;
    }
    // If no instance provided, we'll lazy-load in ensurePerplexity()
    if (params?.model) {
      this.model = params.model;
    }
    this.disableParallelToolCalls = params?.disableParallelToolCalls || false;
  }

  getLanguageModel(): LanguageModel {
    const perplexity = this.ensurePerplexity();
    const options = getSdkClientOptions(perplexity);
    const provider = createOpenAI({
      baseURL: perplexity.baseURL,
      apiKey: perplexity.apiKey,
      headers: options.defaultHeaders,
      fetch: options.fetch,
      name: "perplexity",
    });
    return provider(this.model);
  }

  private ensurePerplexity(): OpenAI {
    if (!this._perplexity) {
      this._perplexity = new Openai({
        baseURL: DEFAULT_BASE_URL,
        defaultHeaders: { [ATTRIBUTION_HEADER]: ATTRIBUTION_VALUE },
      });
    }
    return this._perplexity;
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

    let openaiMessages = messages.map((m) =>
      convertMessageToOpenAIMessage(m, { keepSystemRole: true }),
    );
    openaiMessages = limitMessagesToTokenCount(openaiMessages, tools, model);

    let toolChoice: any = forwardedParameters?.toolChoice;
    if (forwardedParameters?.toolChoice === "function") {
      toolChoice = {
        type: "function",
        function: { name: forwardedParameters.toolChoiceFunctionName },
      };
    }
    let stream;
    try {
      const perplexity = this.ensurePerplexity();
      stream = await perplexity.chat.completions.create({
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
        ...(forwardedParameters?.temperature && {
          temperature: forwardedParameters.temperature,
        }),
      });
    } catch (error) {
      throw convertServiceAdapterError(error, "Perplexity");
    }

    eventSource.stream(async (eventStream$) => {
      let mode: "function" | "message" | null = null;
      let currentMessageId: string;
      let currentToolCallId: string;

      try {
        for await (const chunk of stream) {
          const toolCall = chunk.choices[0].delta.tool_calls?.[0];
          const content = chunk.choices[0].delta.content;

          // When switching from message to function or vice versa,
          // send the respective end event.
          // If toolCall?.id is defined, it means a new tool call starts.
          if (mode === "message" && toolCall?.id) {
            mode = null;
            eventStream$.sendTextMessageEnd({ messageId: currentMessageId });
          } else if (
            mode === "function" &&
            (toolCall === undefined || toolCall?.id)
          ) {
            mode = null;
            eventStream$.sendActionExecutionEnd({
              actionExecutionId: currentToolCallId,
            });
          }

          // If we send a new message type, send the appropriate start event.
          if (mode === null) {
            if (toolCall?.id) {
              mode = "function";
              currentToolCallId = toolCall!.id;
              eventStream$.sendActionExecutionStart({
                actionExecutionId: currentToolCallId,
                actionName: toolCall!.function!.name,
                parentMessageId: chunk.id,
              });
            } else if (content) {
              mode = "message";
              currentMessageId = chunk.id;
              eventStream$.sendTextMessageStart({
                messageId: currentMessageId,
              });
            }
          }

          // send the content events
          if (mode === "message" && content) {
            eventStream$.sendTextMessageContent({
              messageId: currentMessageId,
              content,
            });
          } else if (mode === "function" && toolCall?.function?.arguments) {
            eventStream$.sendActionExecutionArgs({
              actionExecutionId: currentToolCallId,
              args: toolCall.function.arguments,
            });
          }
        }

        // send the end events
        if (mode === "message") {
          eventStream$.sendTextMessageEnd({ messageId: currentMessageId });
        } else if (mode === "function") {
          eventStream$.sendActionExecutionEnd({
            actionExecutionId: currentToolCallId,
          });
        }
      } catch (error) {
        throw convertServiceAdapterError(error, "Perplexity");
      }

      eventStream$.complete();
    });

    return {
      threadId: request.threadId || randomUUID(),
    };
  }
}
