import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { AgentCapabilities } from "@ag-ui/core";
import { Observable } from "rxjs";
import type {
  AcpRunAdmission,
  AcpRunCancellation,
  AcpRunEvents,
} from "./client";

/** The private Intelligence calls required by the public ACP agent facade. */
export interface AcpAgentPlatform {
  ɵadmitAcpRun(params: {
    readonly agentProfileId: string;
    readonly appUserId: string;
    readonly input: RunAgentInput;
  }): Promise<AcpRunAdmission>;
  ɵlistAcpRunEvents(params: {
    readonly runId: string;
    readonly after: number;
  }): Promise<AcpRunEvents>;
  ɵcancelAcpRun(params: {
    readonly runId: string;
  }): Promise<AcpRunCancellation>;
}

/** Configuration for one paid Intelligence-backed ACP agent profile. */
export interface AcpAgentConfig {
  /** Intelligence client authenticated for the owning project. */
  readonly intelligence: AcpAgentPlatform;
  /** Server-owned executable profile configured in Intelligence. */
  readonly agentProfileId: string;
  /** Bare customer application-user id that owns the thread. */
  readonly userId: string;
  /** Delay between empty durable event pages. Defaults to 100 milliseconds. */
  readonly pollIntervalMs?: number;
}

const isTerminalEvent = (event: BaseEvent): boolean =>
  event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR;

const waitForPoll = (delayMs: number, signal: AbortSignal): Promise<void> => {
  if (delayMs === 0 || signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
};

/**
 * AG-UI agent facade for the paid Intelligence ACP bridge.
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
      const poll = async (): Promise<void> => {
        const admission = await this.config.intelligence.ɵadmitAcpRun({
          agentProfileId: this.config.agentProfileId,
          appUserId: this.config.userId,
          input,
        });
        let cursor = admission.cursor;

        while (!controller.signal.aborted) {
          const page = await this.config.intelligence.ɵlistAcpRunEvents({
            after: cursor,
            runId: input.runId,
          });

          for (const stored of page.events) {
            if (stored.sequence <= cursor) {
              throw new Error(
                `Intelligence returned ACP event sequence ${stored.sequence} after cursor ${cursor}.`,
              );
            }
            cursor = stored.sequence;
            subscriber.next(stored.event);
            if (isTerminalEvent(stored.event)) {
              subscriber.complete();
              return;
            }
          }

          if (page.events.length === 0) {
            await waitForPoll(
              this.config.pollIntervalMs ?? 100,
              controller.signal,
            );
          }
        }

        subscriber.complete();
      };

      poll()
        .catch((error: unknown) => subscriber.error(error))
        .finally(() => {
          if (this.activeRun === activeRun) {
            this.activeRun = undefined;
          }
        });

      return () => {
        controller.abort();
      };
    });
  }

  /** Cancels the exact active public AG-UI run in Intelligence. */
  override abortRun(): void {
    const activeRun = this.activeRun;
    if (!activeRun) {
      return;
    }

    activeRun.cancellation ??= this.config.intelligence
      .ɵcancelAcpRun({ runId: activeRun.runId })
      .then(
        () => undefined,
        () => undefined,
      )
      .then(() => activeRun.controller.abort());
  }

  /** Creates an idle agent with the same paid Intelligence profile. */
  clone(): AcpAgent {
    const cloned = new AcpAgent(this.config);
    // AbstractAgent does not expose its middleware chain, but clones must keep it.
    // @ts-expect-error AbstractAgent.middlewares is private in @ag-ui/client.
    cloned.middlewares = [...this.middlewares];
    return cloned;
  }
}
