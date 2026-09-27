import {
  AbstractAgent,
  EventType,
  runHttpRequest,
  transformHttpEventStream,
} from "@copilotkit/vue";
import type { BaseEvent, Message, RunAgentInput } from "@copilotkit/vue";

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
  /** Messages the thread starts with. */
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
  const last = [...input.messages].toReversed().find((m) => m.role === "user");
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  return (last.content ?? [])
    .map((part) => ("text" in part ? part.text : ""))
    .join(" ");
};

const defaultReply = (input: RunAgentInput) =>
  `This is a canned reply from the Storybook agent. You said: **${lastUserText(input) || "nothing yet"}**.\n\nNothing leaves the browser — responses are streamed locally so every chat state can be reviewed without a runtime.`;

const words = (text: string) => text.match(/\S+\s*/g) ?? [text];

/**
 * In-memory AG-UI agent for stories. Streams a canned reply word by word so
 * chat components run through CopilotKit's real agent pipeline without a
 * runtime or network access.
 *
 * Events are encoded as an SSE stream and parsed by AG-UI's own
 * `transformHttpEventStream`, the same path an `HttpAgent` response takes.
 */
export class StoryAgent extends AbstractAgent {
  private options: StoryAgentOptions;
  /** Stops the run currently streaming, if any (wired to the stop button). */
  private stopActiveRun: (() => void) | null = null;

  constructor(options: StoryAgentOptions = {}) {
    super({ agentId: "default", initialMessages: options.initialMessages });
    this.options = options;
  }

  override clone(): this {
    const cloned = super.clone();
    cloned.options = this.options;
    cloned.stopActiveRun = null;
    return cloned;
  }

  override abortRun(): void {
    this.stopActiveRun?.();
    super.abortRun();
  }

  run(input: RunAgentInput) {
    const mcpRequest = (
      input.forwardedProps as
        | { __proxiedMCPRequest?: ProxiedMcpRequest }
        | undefined
    )?.__proxiedMCPRequest;
    if (mcpRequest) {
      const { mcpLatencyMs = 150 } = this.options;
      return this.stream(this.buildMcpEvents(input, mcpRequest), mcpLatencyMs);
    }
    const { chunkDelayMs = 80 } = this.options;
    return this.stream(this.buildEvents(input), chunkDelayMs);
  }

  /**
   * Streams `events` as SSE: the first right away, then one every `delayMs`
   * (never, for `Infinity`).
   */
  private stream(events: BaseEvent[], delayMs: number) {
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | undefined;
    let finish = () => clearInterval(timer);

    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const stop = () => {
          finish();
          // Surfaces as an aborted run, the way HttpAgent reports a cancelled fetch.
          controller.error(new DOMException("Run stopped", "AbortError"));
        };
        finish = () => {
          clearInterval(timer);
          if (this.stopActiveRun === stop) this.stopActiveRun = null;
        };
        this.stopActiveRun = stop;

        const push = () => {
          const event = events.shift();
          if (!event) {
            finish();
            controller.close();
            return;
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        };
        push();
        if (Number.isFinite(delayMs)) timer = setInterval(push, delayMs);
      },
      cancel: () => finish(),
    });

    return transformHttpEventStream(
      runHttpRequest(
        async () =>
          new Response(body, {
            headers: { "content-type": "text/event-stream" },
          }),
      ),
    );
  }

  /** Answers an MCP Apps proxy request from `mcpResources`, as a runtime would. */
  private buildMcpEvents(
    input: RunAgentInput,
    request: ProxiedMcpRequest,
  ): BaseEvent[] {
    const { mcpResources = {} } = this.options;
    const { threadId, runId } = input;
    const uri = request.params?.uri ?? "";
    const resource = mcpResources[uri];
    const result =
      request.method === "resources/read" && resource
        ? { contents: [{ uri, ...resource }] }
        : { contents: [] };
    return [
      { type: EventType.RUN_STARTED, threadId, runId } as BaseEvent,
      { type: EventType.RUN_FINISHED, threadId, runId, result } as BaseEvent,
    ];
  }

  private buildEvents(input: RunAgentInput): BaseEvent[] {
    const { reply = defaultReply, reasoning } = this.options;
    const { threadId, runId } = input;
    const events: BaseEvent[] = [
      { type: EventType.RUN_STARTED, threadId, runId } as BaseEvent,
    ];

    if (reasoning) {
      const messageId = crypto.randomUUID();
      events.push(
        { type: EventType.REASONING_START, messageId } as BaseEvent,
        {
          type: EventType.REASONING_MESSAGE_START,
          messageId,
          role: "reasoning",
        } as BaseEvent,
        ...words(reasoning).map(
          (delta) =>
            ({
              type: EventType.REASONING_MESSAGE_CONTENT,
              messageId,
              delta,
            }) as BaseEvent,
        ),
        { type: EventType.REASONING_MESSAGE_END, messageId } as BaseEvent,
        { type: EventType.REASONING_END, messageId } as BaseEvent,
      );
    }

    const messageId = crypto.randomUUID();
    events.push(
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      } as BaseEvent,
      ...words(reply(input)).map(
        (delta) =>
          ({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId,
            delta,
          }) as BaseEvent,
      ),
      { type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent,
      { type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent,
    );

    return events;
  }
}
