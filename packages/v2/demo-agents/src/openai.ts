import {
  AbstractAgent,
  RunAgentInput,
  EventType,
  BaseEvent,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { OpenAI } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export class OpenAIAgent extends AbstractAgent {
  private openai: OpenAI;

  constructor(openai?: OpenAI) {
    super();
    this.openai = openai ?? new OpenAI();
  }

  clone(): OpenAIAgent {
    return new OpenAIAgent(this.openai);
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      observer.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);

      this.openai.chat.completions
        .create({
          model: "gpt-4o",
          stream: true,
          tools: input.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          messages: input.messages.map(
            (message): ChatCompletionMessageParam => {
              if (message.role === "tool") {
                return {
                  role: "tool",
                  content: message.content ?? "",
                  tool_call_id: message.toolCallId ?? "",
                };
              } else if (message.role === "assistant" && message.toolCalls) {
                return {
                  role: "assistant",
                  content: message.content ?? "",
                  tool_calls: message.toolCalls,
                };
              } else {
                return {
                  role: message.role,
                  content: message.content ?? "",
                } as ChatCompletionMessageParam;
              }
            },
          ),
        })
        .then(async (response) => {
          const messageId = Date.now().toString();
          for await (const chunk of response) {
            if (chunk.choices[0]?.delta?.content) {
              observer.next({
                type: EventType.TEXT_MESSAGE_CHUNK,
                messageId,
                delta: chunk.choices[0].delta.content,
              } as BaseEvent);
            } else if (chunk.choices[0]?.delta?.tool_calls?.[0]) {
              const toolCall = chunk.choices[0].delta.tool_calls[0];
              observer.next({
                type: EventType.TOOL_CALL_CHUNK,
                toolCallId: toolCall.id,
                toolCallName: toolCall.function?.name,
                parentMessageId: messageId,
                delta: toolCall.function?.arguments,
              } as BaseEvent);
            }
          }
          observer.next({
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
          } as BaseEvent);
          observer.complete();
        })
        .catch((error) => {
          observer.next({
            type: EventType.RUN_ERROR,
            message: error.message,
          } as BaseEvent);
          observer.error(error);
        });
    });
  }
}
