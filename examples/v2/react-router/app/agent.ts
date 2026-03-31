import {
  AbstractAgent,
  BaseEvent,
  EventType,
  RunAgentInput,
  Message,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import type { StreamChunk } from "@tanstack/ai";
import { randomUUID } from "crypto";

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  toolCallId?: string;
}

function toChatMessages(messages: Message[]): ChatMessage[] {
  return messages
    .filter((m) => m.role !== "developer" && m.role !== "system")
    .map((m): ChatMessage => {
      const msg: ChatMessage = {
        role: m.role as "user" | "assistant" | "tool",
        content: typeof m.content === "string" ? m.content : null,
      };
      if (m.role === "assistant" && "toolCalls" in m && m.toolCalls) {
        msg.toolCalls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
      }
      if (m.role === "tool" && "toolCallId" in m) {
        msg.toolCallId = (m as Record<string, unknown>).toolCallId as string;
      }
      return msg;
    });
}

function buildSystemPrompts(input: RunAgentInput): string[] {
  const prompts: string[] = [];
  for (const m of input.messages) {
    if ((m.role === "system" || m.role === "developer") && m.content) {
      prompts.push(
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      );
    }
  }
  if (input.context?.length) {
    for (const ctx of input.context) {
      prompts.push(`${ctx.description}:\n${ctx.value}`);
    }
  }
  if (input.state && Object.keys(input.state).length > 0) {
    prompts.push(
      `Application State:\n\`\`\`json\n${JSON.stringify(input.state, null, 2)}\n\`\`\``,
    );
  }
  return prompts;
}

export interface ChatFactoryOptions {
  messages: ChatMessage[];
  systemPrompts: string[];
  abortController: AbortController;
  forwardedProps?: Record<string, unknown>;
}

export type ChatFactory = (
  options: ChatFactoryOptions,
) => AsyncIterable<StreamChunk>;

/**
 * Agent that wraps a TanStack AI chat() call.
 *
 * Instead of forwarding TanStack AI's AG-UI events (which have subtle
 * differences from what CopilotKit expects), we consume the stream for
 * text deltas and re-emit clean events in exactly the same format as
 * BuiltInAgent: RUN_STARTED → TEXT_MESSAGE_CHUNK* → RUN_FINISHED.
 */
export class TanStackAIAgent extends AbstractAgent {
  private abortController?: AbortController;

  constructor(private factory: ChatFactory) {
    super();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      this.abortController = new AbortController();
      const controller = this.abortController;

      const options: ChatFactoryOptions = {
        messages: toChatMessages(input.messages),
        systemPrompts: buildSystemPrompts(input),
        abortController: controller,
        forwardedProps: input.forwardedProps as Record<string, unknown>,
      };

      // Emit RUN_STARTED synchronously, same as BuiltInAgent
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);

      const messageId = randomUUID();

      (async () => {
        try {
          const stream = this.factory(options);
          for await (const chunk of stream) {
            if (controller.signal.aborted) break;

            const raw = chunk as unknown as Record<string, unknown>;
            const type = raw.type as string;

            if (type === "TEXT_MESSAGE_CONTENT" && raw.delta) {
              subscriber.next({
                type: EventType.TEXT_MESSAGE_CHUNK,
                role: "assistant",
                messageId,
                delta: raw.delta,
              } as BaseEvent);
            } else if (type === "TOOL_CALL_START") {
              subscriber.next({
                type: EventType.TOOL_CALL_START,
                parentMessageId: messageId,
                toolCallId: raw.toolCallId,
                toolCallName: raw.toolCallName,
              } as BaseEvent);
            } else if (type === "TOOL_CALL_ARGS") {
              subscriber.next({
                type: EventType.TOOL_CALL_ARGS,
                toolCallId: raw.toolCallId,
                delta: raw.delta,
              } as BaseEvent);
            } else if (type === "TOOL_CALL_END") {
              subscriber.next({
                type: EventType.TOOL_CALL_END,
                toolCallId: raw.toolCallId,
              } as BaseEvent);
            }
          }

          subscriber.next({
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
          } as BaseEvent);
          subscriber.complete();
        } catch (error) {
          if (!controller.signal.aborted) {
            subscriber.next({
              type: EventType.RUN_ERROR,
              message: error instanceof Error ? error.message : String(error),
            } as BaseEvent);
            subscriber.error(error);
          }
        }
      })();

      return () => {
        this.abortController?.abort();
      };
    });
  }

  clone(): TanStackAIAgent {
    return new TanStackAIAgent(this.factory);
  }

  abortRun(): void {
    this.abortController?.abort();
  }
}
