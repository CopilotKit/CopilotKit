import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  BaseEvent,
  Message,
  RunAgentInput,
  RunAgentResult,
  RunStartedEvent,
} from "@ag-ui/client";
import type { Observable } from "rxjs";
import { EMPTY } from "rxjs";

type RunAgentCallbacks = {
  onEvent: (event: { event: BaseEvent }) => void;
  onNewMessage?: (args: { message: Message }) => void;
  onRunStartedEvent?: (args: { event: BaseEvent }) => void;
};

/**
 * Emits RUN_STARTED and a STATE_SNAPSHOT that carries `state.secret`, then
 * finishes. With `hang`, the run stays active until `release()` or
 * `abortRun()` is called.
 */
export class OwnershipTestAgent extends AbstractAgent {
  /** Every hanging run that has not been released yet. */
  private static readonly hanging = new Set<OwnershipTestAgent>();

  /** Release every hanging run, so a failed test leaves none behind. */
  static releaseAll(): void {
    for (const agent of OwnershipTestAgent.hanging) agent.release();
  }

  private releaseRun: (() => void) | null = null;
  private readonly started: Promise<void>;
  private markStarted!: () => void;

  constructor(private readonly hang = false) {
    super();
    this.started = new Promise<void>((resolve) => {
      this.markStarted = resolve;
    });
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }

  clone(): OwnershipTestAgent {
    return new OwnershipTestAgent(this.hang);
  }

  /** Resolves once the run emitted its STATE_SNAPSHOT. */
  whenStarted(): Promise<void> {
    return this.started;
  }

  release(): void {
    OwnershipTestAgent.hanging.delete(this);
    this.releaseRun?.();
  }

  abortRun(): void {
    this.release();
  }

  async runAgent(
    input: RunAgentInput,
    callbacks: RunAgentCallbacks,
  ): Promise<RunAgentResult> {
    const started: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    };
    callbacks.onEvent({ event: started });
    callbacks.onRunStartedEvent?.({ event: started });
    callbacks.onEvent({
      event: {
        type: EventType.STATE_SNAPSHOT,
        snapshot: { secret: (input.state as { secret?: string }).secret },
      } as BaseEvent,
    });
    this.markStarted();
    if (this.hang) {
      OwnershipTestAgent.hanging.add(this);
      await new Promise<void>((resolve) => {
        this.releaseRun = resolve;
      });
    }
    callbacks.onEvent({
      event: {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent,
    });
    return { result: undefined, newMessages: [] };
  }
}

let seq = 0;

export function ownershipThreadId(label: string): string {
  seq += 1;
  return `${label}-${Date.now().toString(36)}-${seq}`;
}

export function ownershipInput(
  threadId: string,
  secret: string,
): RunAgentInput {
  return {
    threadId,
    runId: `run-${threadId}-${Math.random().toString(36).slice(2)}`,
    messages: [
      { id: `msg-${threadId}-${secret}`, role: "user", content: secret },
    ],
    state: { secret },
    tools: [],
    context: [],
    forwardedProps: {},
  };
}

/** Waits until the observable completes; resolves with every event. */
export function collect(stream: Observable<BaseEvent>): Promise<BaseEvent[]> {
  return new Promise((resolve, reject) => {
    const events: BaseEvent[] = [];
    stream.subscribe({
      next: (event) => events.push(event),
      error: reject,
      complete: () => resolve(events),
    });
  });
}
