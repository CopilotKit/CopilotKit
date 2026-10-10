import type {
  SubagentErrorEvent,
  SubagentFinishedEvent,
  SubagentStartedEvent,
} from "@ag-ui/client";

/**
 * Where a subagent invocation is in its life. `suspended` means it is waiting
 * for outside input (an interrupt) and a later run may continue it.
 */
export type SubagentStatus = "running" | "done" | "suspended" | "error";

/**
 * One subagent invocation seen on a thread, built from the AG-UI 1.0
 * `SUBAGENT_STARTED` / `SUBAGENT_FINISHED` / `SUBAGENT_ERROR` events.
 *
 * `subagentRunId` names this invocation, not the kind of subagent; use `name`
 * for that. Messages the subagent produced carry the same `subagentRunId`.
 */
export type Subagent = Pick<
  SubagentStartedEvent,
  | "subagentRunId"
  | "name"
  | "description"
  | "parentSubagentRunId"
  | "parentToolCallId"
  | "parentMessageId"
> & {
  status: SubagentStatus;
  /** The value `SUBAGENT_FINISHED` returned, when the invocation is done. */
  result?: unknown;
  /** The interrupts this invocation raised itself, when it is suspended. */
  interruptIds?: string[];
  /** Why the invocation failed, when its status is `error`. */
  error?: { message: string; code?: string };
};

const cancelledMessage = "The run ended before this subagent finished";

/**
 * @internal Framework-neutral subagent tracking for one agent thread.
 * Application authors must not depend on this API.
 *
 * Every method returns whether the list changed, so a caller notifies only
 * on real changes. `list` keeps its reference until something changes.
 */
export class ɵSubagentState {
  readonly #subagents = new Map<string, Subagent>();
  #list: readonly Subagent[] = [];

  /** The invocations in start order. */
  get list() {
    return this.#list;
  }

  started(event: SubagentStartedEvent) {
    const existing = this.#subagents.get(event.subagentRunId);
    // A second start is valid only as the continuation of a suspended
    // invocation; the client verifier rejects any other repeat upstream.
    if (existing && existing.status !== "suspended") return false;

    this.#subagents.set(event.subagentRunId, {
      subagentRunId: event.subagentRunId,
      name: event.name,
      description: event.description,
      parentSubagentRunId: event.parentSubagentRunId,
      parentToolCallId: event.parentToolCallId,
      parentMessageId: event.parentMessageId,
      status: "running",
    });
    return this.#publish();
  }

  finished(event: SubagentFinishedEvent) {
    const running = this.#running(event.subagentRunId);
    if (!running) return false;

    const { outcome } = event;
    this.#subagents.set(
      event.subagentRunId,
      outcome?.type === "suspended"
        ? {
            ...running,
            status: "suspended",
            interruptIds: outcome.interruptIds ?? [],
          }
        : { ...running, status: "done", result: event.result },
    );
    return this.#publish();
  }

  error(event: SubagentErrorEvent) {
    const running = this.#running(event.subagentRunId);
    if (!running) return false;

    this.#subagents.set(event.subagentRunId, {
      ...running,
      status: "error",
      error: { message: event.message, code: event.code },
    });
    return this.#publish();
  }

  /** A `RUN_ERROR` abandons every open invocation; it gets no closer of its own. */
  runError(message: string) {
    return this.#failRunning({ message, code: "RUN_ERROR" });
  }

  /**
   * The run is over on the client. The protocol closes every invocation
   * before `RUN_FINISHED`, so one still running was cut off, for example by
   * a client-side abort.
   */
  runEnded() {
    return this.#failRunning({ message: cancelledMessage, code: "CANCELLED" });
  }

  clear() {
    if (this.#subagents.size === 0) return false;
    this.#subagents.clear();
    return this.#publish();
  }

  #running(subagentRunId: string) {
    const subagent = this.#subagents.get(subagentRunId);
    return subagent?.status === "running" ? subagent : undefined;
  }

  #failRunning(error: { message: string; code: string }) {
    const subagents = [...this.#subagents.values()];
    const running = subagents.filter(({ status }) => status === "running");
    if (running.length === 0) return false;

    for (const subagent of running) {
      this.#subagents.set(subagent.subagentRunId, {
        ...subagent,
        status: "error",
        error,
      });
    }
    return this.#publish();
  }

  #publish() {
    this.#list = [...this.#subagents.values()];
    return true;
  }
}
