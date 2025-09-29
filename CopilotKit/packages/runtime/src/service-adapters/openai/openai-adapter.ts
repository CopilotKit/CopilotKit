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
 * return new OpenAIAdapter({ openai });
 * ```
 *
 * ## Example with Azure OpenAI
 *
 * ```ts
 * import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/runtime";
 * import OpenAI from "openai";
 *
 * // The name of your Azure OpenAI Instance.
 * // https://learn.microsoft.com/en-us/azure/cognitive-services/openai/how-to/create-resource?pivots=web-portal#create-a-resource
 * const instance = "<your instance name>";
 *
 * // Corresponds to your Model deployment within your OpenAI resource, e.g. my-gpt35-16k-deployment
 * // Navigate to the Azure OpenAI Studio to deploy a model.
 * const model = "<your model>";
 *
 * const apiKey = process.env["AZURE_OPENAI_API_KEY"];
 * if (!apiKey) {
 *   throw new Error("The AZURE_OPENAI_API_KEY environment variable is missing or empty.");
 * }
 *
 * const copilotKit = new CopilotRuntime();
 *
 * const openai = new OpenAI({
 *   apiKey,
 *   baseURL: `https://${instance}.openai.azure.com/openai/deployments/${model}`,
 *   defaultQuery: { "api-version": "2024-04-01-preview" },
 *   defaultHeaders: { "api-key": apiKey },
 * });
 *
 * return new OpenAIAdapter({ openai });
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
import { randomUUID } from "@copilotkit/shared";
import { convertServiceAdapterError } from "../shared";

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

  /**
   * Whether to keep the role in system messages as "System".
   * By default, it is converted to "developer", which is used by newer OpenAI models
   *
   * @default false
   */
  keepSystemRole?: boolean;
}

export class OpenAIAdapter implements CopilotServiceAdapter {
  private model: string = DEFAULT_MODEL;

  private disableParallelToolCalls: boolean = false;
  private _openai: OpenAI;
  private keepSystemRole: boolean = false;

  public get openai(): OpenAI {
    return this._openai;
  }

  constructor(params?: OpenAIAdapterParams) {
    this._openai = params?.openai || new OpenAI({});
    if (params?.model) {
      this.model = params.model;
    }
    this.disableParallelToolCalls = params?.disableParallelToolCalls || false;
    this.keepSystemRole = params?.keepSystemRole ?? false;
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const {
      threadId: threadIdFromRequest,
      model = this.model,
      messages,
      actions,
      eventSource,
      forwardedParameters,
    } = request;
    const tools = actions.map(convertActionInputToOpenAITool);
    const threadId = threadIdFromRequest ?? randomUUID();

    // ALLOWLIST APPROACH: Only include tool_result messages that correspond to valid tool_calls
    // Step 1: Extract valid tool_call IDs
    const validToolUseIds = new Set<string>();

    for (const message of messages) {
      if (message.isActionExecutionMessage()) {
        validToolUseIds.add(message.id);
      }
    }

    // Step 2: Filter messages, keeping only those with valid tool_call IDs
    const filteredMessages = messages.filter((message) => {
      if (message.isResultMessage()) {
        // Skip if there's no corresponding tool_call
        if (!validToolUseIds.has(message.actionExecutionId)) {
          return false;
        }

        // Remove this ID from valid IDs so we don't process duplicates
        validToolUseIds.delete(message.actionExecutionId);
        return true;
      }

      // Keep all non-tool-result messages
      return true;
    });

    let openaiMessages = filteredMessages.map((m) =>
      convertMessageToOpenAIMessage(m, { keepSystemRole: this.keepSystemRole }),
    );
    openaiMessages = limitMessagesToTokenCount(openaiMessages, tools, model);

    let toolChoice: any = forwardedParameters?.toolChoice;
    if (forwardedParameters?.toolChoice === "function") {
      toolChoice = {
        type: "function",
        function: { name: forwardedParameters.toolChoiceFunctionName },
      };
    }

    try {
      const stream = this.openai.beta.chat.completions.stream({
        model: model,
        stream: true,
        messages: openaiMessages,
        ...(tools.length > 0 && { tools }),
        ...(forwardedParameters?.maxTokens && {
          max_completion_tokens: forwardedParameters.maxTokens,
        }),
        ...(forwardedParameters?.stop && { stop: forwardedParameters.stop }),
        ...(toolChoice && { tool_choice: toolChoice }),
        ...(this.disableParallelToolCalls && { parallel_tool_calls: false }),
        ...(forwardedParameters?.temperature && { temperature: forwardedParameters.temperature }),
      });

      eventSource.stream(async (eventStream$) => {
        let mode: "function" | "message" | null = null;
        let currentMessageId: string;
        let currentToolCallId: string;

        try {
          for await (const chunk of stream) {
            if (chunk.choices.length === 0) {
              continue;
            }

            const toolCall = chunk.choices[0].delta.tool_calls?.[0];
            const content = chunk.choices[0].delta.content;

            // When switching from message to function or vice versa,
            // send the respective end event.
            // If toolCall?.id is defined, it means a new tool call starts.
            if (mode === "message" && toolCall?.id) {
              mode = null;
              eventStream$.sendTextMessageEnd({ messageId: currentMessageId });
            } else if (mode === "function" && (toolCall === undefined || toolCall?.id)) {
              mode = null;
              eventStream$.sendActionExecutionEnd({ actionExecutionId: currentToolCallId });
            }

            // If we send a new message type, send the appropriate start event.
            if (mode === null) {
              if (toolCall?.id) {
                mode = "function";
                currentToolCallId = toolCall!.id;
                eventStream$.sendActionExecutionStart({
                  actionExecutionId: currentToolCallId,
                  parentMessageId: chunk.id,
                  actionName: toolCall!.function!.name,
                });
              } else if (content) {
                mode = "message";
                currentMessageId = chunk.id;
                eventStream$.sendTextMessageStart({ messageId: currentMessageId });
              }
            }

            // send the content events
            if (mode === "message" && content) {
              eventStream$.sendTextMessageContent({
                messageId: currentMessageId,
                content: content,
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
            eventStream$.sendActionExecutionEnd({ actionExecutionId: currentToolCallId });
          }
        } catch (error) {
          console.error("[OpenAI] Error during API call:", error);
          throw convertServiceAdapterError(error, "OpenAI");
        }

        eventStream$.complete();
      });
    } catch (error) {
      console.error("[OpenAI] Error during API call:", error);
      throw convertServiceAdapterError(error, "OpenAI");
    }

    return {
      threadId,
    };
  }
}
