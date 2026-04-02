import {
  AbstractAgent,
  BaseEvent,
  EventType,
  RunAgentInput,
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { convertAISDKStream } from "./converters/aisdk";
import { convertTanStackStream } from "./converters/tanstack";

/**
 * Context passed to the user-supplied factory function.
 */
export interface AgentFactoryContext {
  input: RunAgentInput;
  abortController: AbortController;
  abortSignal: AbortSignal;
}

/**
 * Configuration for an agent backed by the Vercel AI SDK.
 * The factory must return an object with a `fullStream` async iterable
 * (the same shape returned by `streamText()` from the `ai` package).
 */
export interface AISDKAgentConfig {
  type: "aisdk";
  factory: (
    ctx: AgentFactoryContext,
  ) =>
    | { fullStream: AsyncIterable<unknown> }
    | Promise<{ fullStream: AsyncIterable<unknown> }>;
}

/**
 * Configuration for an agent backed by TanStack AI.
 * The factory must return an async iterable of TanStack AI stream chunks.
 */
export interface TanStackAgentConfig {
  type: "tanstack";
  factory: (
    ctx: AgentFactoryContext,
  ) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;
}

/**
 * Configuration for a custom agent that directly yields AG-UI events.
 * The factory must return an async iterable of `BaseEvent` objects.
 */
export interface CustomAgentConfig {
  type: "custom";
  factory: (
    ctx: AgentFactoryContext,
  ) => AsyncIterable<BaseEvent> | Promise<AsyncIterable<BaseEvent>>;
}

/**
 * Discriminated union of all supported agent configurations.
 */
export type AgentConfig =
  | AISDKAgentConfig
  | TanStackAgentConfig
  | CustomAgentConfig;

/**
 * Universal Agent class that wraps any supported stream source
 * (AI SDK, TanStack AI, or custom) and emits AG-UI events via an Observable.
 *
 * The Agent handles lifecycle events (RUN_STARTED / RUN_FINISHED / RUN_ERROR)
 * while delegating stream-to-event conversion to the appropriate converter.
 */
export class Agent extends AbstractAgent {
  private abortController?: AbortController;

  constructor(private config: AgentConfig) {
    super();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    if (this.abortController) {
      throw new Error(
        "Agent is already running. Call abortRun() first or create a new instance.",
      );
    }

    // Set synchronously before Observable creation to close the TOCTOU window
    // between the guard check above and the subscriber callback.
    this.abortController = new AbortController();
    const controller = this.abortController;

    return new Observable<BaseEvent>((subscriber) => {
      // Emit RUN_STARTED before entering the async factory
      const startEvent: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      };
      subscriber.next(startEvent);

      const ctx: AgentFactoryContext = {
        input,
        abortController: controller,
        abortSignal: controller.signal,
      };

      (async () => {
        try {
          let events: AsyncIterable<BaseEvent>;

          switch (this.config.type) {
            case "aisdk": {
              const result = await this.config.factory(ctx);
              events = convertAISDKStream(result.fullStream, controller.signal);
              break;
            }
            case "tanstack": {
              const stream = await this.config.factory(ctx);
              events = convertTanStackStream(stream, controller.signal);
              break;
            }
            case "custom": {
              events = await this.config.factory(ctx);
              break;
            }
            default: {
              const _exhaustive: never = this.config;
              throw new Error(
                `Unknown agent config type: ${(_exhaustive as AgentConfig).type}`,
              );
            }
          }

          for await (const event of events) {
            subscriber.next(event);
          }

          // Stream completed — emit RUN_FINISHED if not aborted
          if (!controller.signal.aborted) {
            const finishedEvent: RunFinishedEvent = {
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
            };
            subscriber.next(finishedEvent);
          }
          subscriber.complete();
        } catch (error) {
          if (controller.signal.aborted) {
            subscriber.complete();
          } else {
            const runErrorEvent: RunErrorEvent = {
              type: EventType.RUN_ERROR,
              message: error instanceof Error ? error.message : String(error),
              threadId: input.threadId,
              runId: input.runId,
            } as RunErrorEvent;
            subscriber.next(runErrorEvent);
            subscriber.error(error);
          }
        } finally {
          this.abortController = undefined;
        }
      })();

      // Observable teardown — abort the stream if unsubscribed
      return () => {
        controller.abort();
      };
    });
  }

  clone(): Agent {
    const cloned = new Agent(this.config);
    // AbstractAgent.middlewares is private — no public getter exists.
    // This mirrors AbstractAgent's own clone() implementation which
    // accesses the field directly. If AbstractAgent ever exposes
    // getMiddlewares(), switch to that.
    // @ts-expect-error - accessing private property from parent (see above)
    cloned.middlewares = [...this.middlewares];
    return cloned;
  }

  abortRun(): void {
    this.abortController?.abort();
  }
}
