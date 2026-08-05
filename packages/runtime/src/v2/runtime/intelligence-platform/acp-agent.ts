import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { AgentCapabilities } from "@ag-ui/core";
import { Observable } from "rxjs";
import type {
  AcpRunAdmission,
  AcpRunCancellation,
  AcpStoredEvent,
} from "./client";
import { AcpRunStreamError } from "./client";

/** The private Intelligence calls required by the public ACP agent facade. */
export interface AcpAgentPlatform {
  ɵadmitAcpRun(params: {
    readonly agentProfileId: string;
    readonly appUserId: string;
    readonly input: RunAgentInput;
  }): Promise<AcpRunAdmission>;
  ɵstreamAcpRunEvents(params: {
    readonly runId: string;
    readonly after: number;
    readonly signal: AbortSignal;
  }): AsyncIterable<AcpStoredEvent>;
  ɵcancelAcpRun(params: {
    readonly runId: string;
  }): Promise<AcpRunCancellation>;
}

/** Configuration for one Intelligence-backed ACP agent profile. */
export interface AcpAgentConfig {
  /** Intelligence client authenticated for the owning project. */
  readonly intelligence: AcpAgentPlatform;
  /** Server-owned executable profile configured in Intelligence. */
  readonly agentProfileId: string;
  /** Bare customer application-user id that owns the thread. */
  readonly userId: string;
  /** Base delay after a dropped stream. Defaults to 250 milliseconds. */
  readonly reconnectDelayMs?: number;
}

const isTerminalEvent = (event: BaseEvent): boolean =>
  event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR;

const waitForReconnect = (
  baseDelayMs: number,
  attempt: number,
  signal: AbortSignal,
): Promise<void> => {
  const cappedDelay = Math.min(baseDelayMs * 2 ** attempt, 5_000);
  const delayMs =
    cappedDelay === 0
      ? 0
      : Math.round(cappedDelay * (0.5 + Math.random() * 0.5));
  if (delayMs === 0 || signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });
};

/**
 * AG-UI agent facade for the Intelligence ACP bridge.
 *
 * This class only handles admission, durable event replay, and cancellation.
 * ACP processes, protocol translation, and persistence stay inside
 * Intelligence.
 */
export class AcpAgent extends AbstractAgent {
  private activeRun?: {
    readonly controller: AbortController;
    readonly runId: string;
    cancellation?: Promise<void>;
  };

  constructor(private readonly config: AcpAgentConfig) {
    super();
    if (
      config.reconnectDelayMs !== undefined &&
      (!Number.isSafeInteger(config.reconnectDelayMs) ||
        config.reconnectDelayMs < 0)
    ) {
      throw new Error(
        "AcpAgent reconnectDelayMs must be a non-negative integer.",
      );
    }
  }

  /** Reports the AG-UI features exposed by the Intelligence ACP bridge. */
  async getCapabilities(): Promise<AgentCapabilities> {
    return {
      transport: { streaming: true },
      humanInTheLoop: { interrupts: true },
    };
  }

  /** Admits one ACP prompt and replays its translated durable AG-UI events. */
  run(input: RunAgentInput): Observable<BaseEvent> {
    if (this.activeRun) {
      throw new Error(
        "Agent is already running. Call abortRun() first or create a new instance.",
      );
    }

    const controller = new AbortController();
    const activeRun = { controller, runId: input.runId };
    this.activeRun = activeRun;

    return new Observable<BaseEvent>((subscriber) => {
      const releaseActiveRun = (): void => {
        if (this.activeRun === activeRun) {
          this.activeRun = undefined;
        }
      };
      const stream = async (): Promise<void> => {
        const admission = await this.config.intelligence.ɵadmitAcpRun({
          agentProfileId: this.config.agentProfileId,
          appUserId: this.config.userId,
          input,
        });
        let cursor = admission.cursor;
        let reconnectAttempt = 0;

        while (!controller.signal.aborted) {
          try {
            for await (const stored of this.config.intelligence.ɵstreamAcpRunEvents(
              {
                after: cursor,
                runId: input.runId,
                signal: controller.signal,
              },
            )) {
              if (stored.sequence <= cursor) {
                throw new Error(
                  `Intelligence returned ACP event sequence ${stored.sequence} after cursor ${cursor}.`,
                );
              }
              cursor = stored.sequence;
              reconnectAttempt = 0;
              subscriber.next(stored.event);
              if (isTerminalEvent(stored.event)) {
                releaseActiveRun();
                subscriber.complete();
                return;
              }
            }
          } catch (error) {
            if (controller.signal.aborted) break;
            if (!(error instanceof AcpRunStreamError) || !error.retryable) {
              throw error;
            }
          }
          await waitForReconnect(
            this.config.reconnectDelayMs ?? 250,
            reconnectAttempt,
            controller.signal,
          );
          reconnectAttempt += 1;
        }

        releaseActiveRun();
        subscriber.complete();
      };

      stream().catch((error: unknown) => {
        releaseActiveRun();
        subscriber.error(error);
      });

      return () => {
        controller.abort();
        releaseActiveRun();
      };
    });
  }

  /** Cancels the exact active public AG-UI run in Intelligence. */
  override abortRun(): void {
    const activeRun = this.activeRun;
    if (!activeRun) {
      return;
    }

    if (activeRun.cancellation) return;
    const cancellation = this.config.intelligence
      .ɵcancelAcpRun({ runId: activeRun.runId })
      .then(
        (result) => {
          if (result.accepted) {
            activeRun.controller.abort();
          } else if (activeRun.cancellation === cancellation) {
            activeRun.cancellation = undefined;
          }
        },
        () => {
          if (activeRun.cancellation === cancellation) {
            activeRun.cancellation = undefined;
          }
        },
      );
    activeRun.cancellation = cancellation;
  }

  /** Creates an idle agent with the same Intelligence profile. */
  clone(): AcpAgent {
    const cloned = new AcpAgent(this.config);
    // AbstractAgent does not expose its middleware chain, but clones must keep it.
    // @ts-expect-error AbstractAgent.middlewares is private in @ag-ui/client.
    cloned.middlewares = [...this.middlewares];
    return cloned;
  }
}
