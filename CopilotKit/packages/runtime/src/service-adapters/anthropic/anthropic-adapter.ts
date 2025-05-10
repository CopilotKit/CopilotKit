/**
 * Copilot Runtime adapter for Anthropic.
 *
 * ## Example
 *
 * ```ts
 * import { CopilotRuntime, AnthropicAdapter } from "@copilotkit/runtime";
 * import Anthropic from "@anthropic-ai/sdk";
 *
 * const copilotKit = new CopilotRuntime();
 *
 * const anthropic = new Anthropic({
 *   apiKey: "<your-api-key>",
 * });
 *
 * return new AnthropicAdapter({ anthropic });
 * ```
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  CopilotServiceAdapter,
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../service-adapter";
import {
  convertActionInputToAnthropicTool,
  convertMessageToAnthropicMessage,
  groupAnthropicMessagesByRole,
  limitMessagesToTokenCount,
} from "./utils";

import { randomId, randomUUID } from "@copilotkit/shared";

const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

export interface AnthropicAdapterParams {
  /**
   * An optional Anthropic instance to use.  If not provided, a new instance will be
   * created.
   */
  anthropic?: Anthropic;

  /**
   * The model to use.
   */
  model?: string;
}

export class AnthropicAdapter implements CopilotServiceAdapter {
  private model: string = DEFAULT_MODEL;

  private _anthropic: Anthropic;
  public get anthropic(): Anthropic {
    return this._anthropic;
  }

  constructor(params?: AnthropicAdapterParams) {
    this._anthropic = params?.anthropic || new Anthropic({});
    if (params?.model) {
      this.model = params.model;
    }
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const {
      threadId,
      model = this.model,
      messages: rawMessages,
      actions,
      eventSource,
      forwardedParameters,
    } = request;
    const tools = actions.map(convertActionInputToAnthropicTool);

    const messages = [...rawMessages];

    // get the instruction message
    const instructionsMessage = messages.shift();
    const instructions = instructionsMessage.isTextMessage() ? instructionsMessage.content : "";

    // COMPLETELY DIFFERENT APPROACH:
    // 1. First, identify all valid tool_use calls (from assistant)
    // 2. Then, only keep tool_result blocks that correspond to these valid tool_use IDs
    // 3. Discard any other tool_result blocks

    // Step 1: Extract valid tool_use IDs
    const validToolUseIds = new Set<string>();

    for (const message of messages) {
      if (message.isActionExecutionMessage()) {
        validToolUseIds.add(message.id);
      }
    }

    console.log(`[Anthropic] Found ${validToolUseIds.size} valid tool_use IDs`);

    // Step 2: Map each message to an Anthropic message, eliminating invalid tool_results
    const anthropicMessages = messages
      .map((message) => {
        // For tool results, only include if they match a valid tool_use ID
        if (message.isResultMessage()) {
          // Skip if there's no corresponding tool_use
          if (!validToolUseIds.has(message.actionExecutionId)) {
            console.log(
              `[Anthropic] Skipping tool_result with invalid tool_use_id: ${message.actionExecutionId}`,
            );
            return null; // Will be filtered out later
          }

          // Remove this ID from valid IDs so we don't process duplicates
          validToolUseIds.delete(message.actionExecutionId);

          return {
            role: "user",
            content: [
              {
                type: "tool_result",
                content: message.result,
                tool_use_id: message.actionExecutionId,
              },
            ],
          };
        }

        // For non-tool-result messages, convert normally
        return convertMessageToAnthropicMessage(message);
      })
      .filter(Boolean) as Anthropic.Messages.MessageParam[]; // Explicitly cast after filtering nulls

    // Apply token limits
    const limitedMessages = limitMessagesToTokenCount(anthropicMessages, tools, model);

    // We skip grouping by role since we've already ensured uniqueness of tool_results

    let toolChoice: any = forwardedParameters?.toolChoice;
    if (forwardedParameters?.toolChoice === "function") {
      toolChoice = {
        type: "tool",
        name: forwardedParameters.toolChoiceFunctionName,
      };
    }

    try {
      // Log what we're sending to Anthropic
      console.log(`[Anthropic] Sending ${limitedMessages.length} messages to API`);

      const createParams = {
        system: instructions,
        model: this.model,
        messages: limitedMessages,
        max_tokens: forwardedParameters?.maxTokens || 1024,
        ...(forwardedParameters?.temperature
          ? { temperature: forwardedParameters.temperature }
          : {}),
        ...(tools.length > 0 && { tools }),
        ...(toolChoice && { tool_choice: toolChoice }),
        stream: true,
      };

      // Optional: Uncomment to log full payload for debugging
      // console.log('[Anthropic] Request payload:', JSON.stringify(createParams));

      const stream = await this.anthropic.messages.create(createParams);

      eventSource.stream(async (eventStream$) => {
        let mode: "function" | "message" | null = null;
        let didOutputText = false;
        let currentMessageId = randomId();
        let currentToolCallId = randomId();
        let filterThinkingTextBuffer = new FilterThinkingTextBuffer();

        try {
          for await (const chunk of stream as AsyncIterable<any>) {
            if (chunk.type === "message_start") {
              currentMessageId = chunk.message.id;
            } else if (chunk.type === "content_block_start") {
              if (chunk.content_block.type === "text") {
                didOutputText = false;
                filterThinkingTextBuffer.reset();
                mode = "message";
              } else if (chunk.content_block.type === "tool_use") {
                currentToolCallId = chunk.content_block.id;
                eventStream$.sendActionExecutionStart({
                  actionExecutionId: currentToolCallId,
                  actionName: chunk.content_block.name,
                  parentMessageId: currentMessageId,
                });
                mode = "function";
              }
            } else if (chunk.type === "content_block_delta") {
              if (chunk.delta.type === "text_delta") {
                const text = filterThinkingTextBuffer.onTextChunk(chunk.delta.text);
                if (text.length > 0) {
                  if (!didOutputText) {
                    eventStream$.sendTextMessageStart({ messageId: currentMessageId });
                    didOutputText = true;
                  }
                  eventStream$.sendTextMessageContent({
                    messageId: currentMessageId,
                    content: text,
                  });
                }
              } else if (chunk.delta.type === "input_json_delta") {
                eventStream$.sendActionExecutionArgs({
                  actionExecutionId: currentToolCallId,
                  args: chunk.delta.partial_json,
                });
              }
            } else if (chunk.type === "content_block_stop") {
              if (mode === "message") {
                if (didOutputText) {
                  eventStream$.sendTextMessageEnd({ messageId: currentMessageId });
                }
              } else if (mode === "function") {
                eventStream$.sendActionExecutionEnd({ actionExecutionId: currentToolCallId });
              }
            }
          }
        } catch (error) {
          console.error("[Anthropic] Error processing stream:", error);
          throw error;
        }

        eventStream$.complete();
      });
    } catch (error) {
      console.error("[Anthropic] Error during API call:", error);
      throw error;
    }

    return {
      threadId: threadId || randomUUID(),
    };
  }
}

const THINKING_TAG = "<thinking>";
const THINKING_TAG_END = "</thinking>";

class FilterThinkingTextBuffer {
  private buffer: string;
  private didFilterThinkingTag: boolean = false;

  constructor() {
    this.buffer = "";
  }

  onTextChunk(text: string): string {
    this.buffer += text;
    if (this.didFilterThinkingTag) {
      return text;
    }
    const potentialTag = this.buffer.slice(0, THINKING_TAG.length);
    if (THINKING_TAG.startsWith(potentialTag)) {
      if (this.buffer.includes(THINKING_TAG_END)) {
        const end = this.buffer.indexOf(THINKING_TAG_END);
        const filteredText = this.buffer.slice(end + THINKING_TAG_END.length);
        this.buffer = filteredText;
        this.didFilterThinkingTag = true;
        return filteredText;
      } else {
        return "";
      }
    }
    return text;
  }

  reset() {
    this.buffer = "";
    this.didFilterThinkingTag = false;
  }
}
