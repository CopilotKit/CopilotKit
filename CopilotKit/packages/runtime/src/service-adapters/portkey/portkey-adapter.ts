/**
 * Copilot Runtime adapter for Portkey.
 *
 * ## Example
 *
 * ```ts
 * import { CopilotRuntime, PortkeyAIAdapter } from "@copilotkit/runtime";
 * import { Portkey } from "portkey-ai";
 *
 * const copilotKit = new CopilotRuntime();
 *
 * const portkey = new Portkey({
 *   apiKey: "<your-api-key>",
 *   virtualKey: "<your-virtual-key>",
 * });  
 *
 * const serviceAdapter = new PortkeyAIAdapter({ portkey, model: "claude-3-5-sonnet-20240620" });
 *
 * return copilotKit.streamHttpServerResponse(req, res, serviceAdapter);
 * ```
 */
import {Portkey} from "portkey-ai";
import { CopilotRuntimeChatCompletionRequest, CopilotRuntimeChatCompletionResponse, CopilotServiceAdapter } from "../service-adapter";
import { randomId } from "@copilotkit/shared";
import { convertActionInputToPortkeyTool, convertMessageToPortkeyMessage } from "./utils";

type PortkeyClient = InstanceType<typeof Portkey>;

export interface PortkeyAIAdapter {
    portkey: PortkeyClient;
    model?: string;
}

export class PortkeyAIAdapter implements CopilotServiceAdapter {
    private client: PortkeyClient;
    private _model: string;

    constructor(params: PortkeyAIAdapter) {
        this.client = params.portkey;
        this._model = params.model;
    }

    async process(request: CopilotRuntimeChatCompletionRequest): Promise<CopilotRuntimeChatCompletionResponse> {
        const {
            threadId,
            model,
            messages,
            actions,
            eventSource,
            forwardedParameters,
          } = request;

        const portkeyMessages = messages.map(convertMessageToPortkeyMessage);
        const tools = actions.map(convertActionInputToPortkeyTool);

        let toolChoice: any = forwardedParameters?.toolChoice;
        if (forwardedParameters?.toolChoice === "function") {
          toolChoice = {
            type: "function",
            function: { name: forwardedParameters.toolChoiceFunctionName },
          };
        }

        // @ts-ignore
        const responseStream = await this.client.chat.completions.create({
            model: model ?? this._model,
            messages: portkeyMessages,
            tools: tools,
            ...(forwardedParameters?.maxTokens && { max_tokens: forwardedParameters.maxTokens }),
            ...(forwardedParameters?.stop && { stop: forwardedParameters.stop }),
            ...(toolChoice && { tool_choice: toolChoice }),
            stream: true,
        })

        eventSource.stream(async (eventStream$) => {
            let mode: "function" | "message" | null = null;
            for await (const chunk of responseStream) {
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
        }
    }
}
