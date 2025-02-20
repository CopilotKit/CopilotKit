/**
 * CopilotKit Adapter for Unify
 *
 * <RequestExample>
 * ```jsx CopilotRuntime Example
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(req, new UnifyAdapter());
 * ```
 * </RequestExample>
 *
 * You can easily set the model to use by passing it to the constructor.
 * ```jsx
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(
 *   req,
 *   new UnifyAdapter({ model: "llama-3-8b-chat@fireworks-ai" }),
 * );
 * ```
 */
import {
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
  CopilotServiceAdapter,
} from "../service-adapter";
import OpenAI from "openai";
import { randomId, randomUUID } from "@copilotkit/shared";
import { convertActionInputToOpenAITool, convertMessageToOpenAIMessage } from "../openai/utils";

export interface UnifyAdapterParams {
  apiKey?: string;
  model: string;
}

export class UnifyAdapter implements CopilotServiceAdapter {
  private apiKey: string;
  private model: string;
  private start: boolean;

  constructor(options?: UnifyAdapterParams) {
    if (options?.apiKey) {
      this.apiKey = options.apiKey;
    } else {
      this.apiKey = "UNIFY_API_KEY";
    }
    this.model = options?.model;
    this.start = true;
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const tools = request.actions.map(convertActionInputToOpenAITool);
    const openai = new OpenAI({
      apiKey: this.apiKey,
      baseURL: "https://api.unify.ai/v0/",
    });
    const forwardedParameters = request.forwardedParameters;

    const messages = request.messages.map((m) => convertMessageToOpenAIMessage(m));

    const stream = await openai.chat.completions.create({
      model: this.model,
      messages: messages,
      stream: true,
      ...(tools.length > 0 && { tools }),
      ...(forwardedParameters?.temperature && { temperature: forwardedParameters.temperature }),
    });

    let model = null;
    let currentMessageId: string;
    let currentToolCallId: string;
    request.eventSource.stream(async (eventStream$) => {
      let mode: "function" | "message" | null = null;
      for await (const chunk of stream) {
        if (this.start) {
          model = chunk.model;
          currentMessageId = randomId();
          eventStream$.sendTextMessageStart({ messageId: currentMessageId });
          eventStream$.sendTextMessageContent({
            messageId: currentMessageId,
            content: `Model used: ${model}\n`,
          });
          eventStream$.sendTextMessageEnd({ messageId: currentMessageId });
          this.start = false;
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

      eventStream$.complete();
    });

    return {
      threadId: request.threadId || randomUUID(),
    };
  }
}
