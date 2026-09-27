import { AbstractAgent, EventType } from "@copilotkit/react-core/v2";
import type {
  BaseEvent,
  Message,
  RunAgentInput,
} from "@copilotkit/react-core/v2";
import { Observable } from "rxjs";

/** A resource served in reply to an MCP Apps `resources/read` request. */
export interface StoryMcpResource {
  mimeType?: string;
  text: string;
  _meta?: Record<string, unknown>;
}

export interface StoryAgentOptions {
  /** Builds the assistant reply for a run. Defaults to echoing the last user message. */
  reply?: (input: RunAgentInput) => string;
  /** Optional reasoning streamed before the reply. */
  reasoning?: string;
  /** Delay between streamed word chunks, in ms. */
  chunkDelayMs?: number;
  /**
   * Conversation history restored when a chat connects to the thread, the way
   * a runtime replays a stored thread. Only chats bound to an explicit thread
   * connect (the global Storybook decorator sets one for every story).
   */
  initialMessages?: Message[];
  /**
   * Widget resources answered for MCP Apps `resources/read` proxy requests,
   * keyed by resource URI. Lets `MCPAppsActivityRenderer` load offline.
   */
  mcpResources?: Record<string, StoryMcpResource>;
  /** Delay before answering an MCP request, in ms. `Infinity` never answers. */
  mcpLatencyMs?: number;
}

interface ProxiedMcpRequest {
  method?: string;
  params?: { uri?: string };
}

const lastUserText = (input: RunAgentInput): string => {
  const last = input.messages.filter((m) => m.role === "user").at(-1);
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  return (last.content ?? [])
    .map((part) => ("text" in part ? part.text : ""))
    .join(" ");
};

const defaultReply = (input: RunAgentInput) =>
  `This is a canned reply from the Storybook agent. You said: **${lastUserText(input) || "nothing yet"}**.\n\nNothing leaves the browser — responses are streamed locally so every chat state can be reviewed without a runtime.`;

/**
 * In-memory AG-UI agent for stories. Streams a canned reply word by word so
 * chat components run through CopilotKit's real agent pipeline without a
 * runtime or network access.
 */
export class StoryAgent extends AbstractAgent {
  private options: StoryAgentOptions;

  constructor(options: StoryAgentOptions = {}) {
    super({ agentId: "default" });
    this.options = options;
  }

  clone(): this {
    const cloned = super.clone();
    cloned.options = this.options;
    return cloned;
  }

  protected connect(input: RunAgentInput): Observable<BaseEvent> {
    const { initialMessages } = this.options;
    // No stored history: behave like an agent without connect support.
    if (!initialMessages?.length) return super.connect(input);

    return new Observable<BaseEvent>((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      subscriber.next({
        type: EventType.MESSAGES_SNAPSHOT,
        messages: structuredClone(initialMessages),
      } as BaseEvent);
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      subscriber.complete();
    });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    const mcpRequest = (
      input.forwardedProps as
        | { __proxiedMCPRequest?: ProxiedMcpRequest }
        | undefined
    )?.__proxiedMCPRequest;
    if (mcpRequest) return this.answerMcpRequest(input, mcpRequest);

    const { reply = defaultReply, reasoning, chunkDelayMs = 80 } = this.options;

    return new Observable<BaseEvent>((subscriber) => {
      const queue: BaseEvent[] = [];
      const words = (text: string) => text.match(/\S+\s*/g) ?? [text];

      if (reasoning) {
        const reasoningId = crypto.randomUUID();
        queue.push(
          { type: EventType.REASONING_START, messageId: reasoningId },
          {
            type: EventType.REASONING_MESSAGE_START,
            messageId: reasoningId,
            role: "reasoning",
          },
          ...words(reasoning).map((delta) => ({
            type: EventType.REASONING_MESSAGE_CONTENT,
            messageId: reasoningId,
            delta,
          })),
          { type: EventType.REASONING_MESSAGE_END, messageId: reasoningId },
          { type: EventType.REASONING_END, messageId: reasoningId },
        );
      }

      const messageId = crypto.randomUUID();
      queue.push(
        { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" },
        ...words(reply(input)).map((delta) => ({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta,
        })),
        { type: EventType.TEXT_MESSAGE_END, messageId },
        {
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
        },
      );

      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);

      const timer = setInterval(() => {
        const event = queue.shift();
        if (!event) {
          clearInterval(timer);
          subscriber.complete();
          return;
        }
        subscriber.next(event);
      }, chunkDelayMs);

      return () => clearInterval(timer);
    });
  }

  /** Answers an MCP Apps proxy request from `mcpResources`, as a runtime would. */
  private answerMcpRequest(
    input: RunAgentInput,
    request: ProxiedMcpRequest,
  ): Observable<BaseEvent> {
    const { mcpResources = {}, mcpLatencyMs = 150 } = this.options;

    return new Observable<BaseEvent>((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      if (!Number.isFinite(mcpLatencyMs)) return;

      const uri = request.params?.uri ?? "";
      const resource = mcpResources[uri];
      const result =
        request.method === "resources/read" && resource
          ? { contents: [{ uri, ...resource }] }
          : { contents: [] };

      const timer = setTimeout(() => {
        subscriber.next({
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
          result,
        } as BaseEvent);
        subscriber.complete();
      }, mcpLatencyMs);
      return () => clearTimeout(timer);
    });
  }
}
