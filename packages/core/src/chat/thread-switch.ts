import type { AbstractAgent } from "@ag-ui/client";
import type { CopilotKitCore } from "../core/core";
import { CopilotKitCoreErrorCode } from "../core/core";
import {
  ɵclearAgentThreadCursors,
  ɵresetAgentThreadBaseline,
} from "../core/thread-baseline";
import { ɵstopAgentWithFallback } from "./session";

/** What a chat shows: the agent, the thread, and whether the caller picked it. */
export interface ɵThreadSelectionInput {
  agent: AbstractAgent;
  threadId: string;
  /**
   * Whether a caller picked this thread (a `threadId` prop, a thread list, the
   * inspector). An explicit thread exists on the backend and is connected; a
   * non-explicit one is a locally minted id the backend has never seen.
   */
  explicit: boolean;
  /** The inspector override this selection came from, if any. */
  inspectorRequestId?: string | null;
}

/** The result of a connection the chat started, for a send waiting on it. */
export type ɵConnectionWaitResult = "ready" | "failed" | "stale";

/**
 * One thread a chat showed. Stays current until the chat selects another
 * thread, releases it (unmount, effect cleanup), or the coordinator is
 * disposed.
 */
export class ɵThreadSelection {
  /** Set when a fresh thread replaced this one on the same agent. */
  private discardedBaselineReset?: () => void;
  private released = false;

  constructor(
    private readonly coordinator: ɵThreadSwitchCoordinator,
    readonly agent: AbstractAgent,
    readonly threadId: string,
    readonly explicit: boolean,
    readonly inspectorRequestId: string | null,
  ) {}

  /** Whether this is still the thread the chat shows. */
  get isCurrent() {
    return !this.released && this.coordinator.isCurrentSelection(this);
  }

  /** Whether {@link release} ran. */
  get isReleased() {
    return this.released;
  }

  /** Whether the chat should `/connect` this thread: only threads a caller picked exist on the backend. */
  get shouldConnect() {
    return this.explicit;
  }

  /** Marks the selection as no longer shown. Async work started for it stops applying. */
  release() {
    this.released = true;
  }

  /**
   * For a connect of this thread that was still loading when the user moved
   * on to a fresh thread: clears whatever it applied, so the fresh thread
   * shows empty instead of this thread's messages. Does nothing once the
   * fresh thread itself is no longer current.
   */
  clearDiscardedBaseline() {
    this.discardedBaselineReset?.();
  }

  /** @internal */
  setDiscardedBaselineReset(reset: () => void) {
    this.discardedBaselineReset = reset;
  }
}

/**
 * Keeps a chat's agent on the thread the chat shows, and keeps the teardown of
 * the previous thread ordered.
 *
 * On every selection it pins `agent.threadId`. Moving into or out of an
 * inspector override stops the running agent. Moving to a fresh,
 * non-explicit thread empties the agent (messages, state, interrupts, the
 * discarded thread's cursors) once its active run has detached. A connect
 * waits for {@link whenTornDown} so it never races that reset, and a send
 * waits for {@link waitForConnection}.
 *
 * Framework-neutral: React calls {@link select} from an effect, Vue from a
 * watcher, Angular from an effect, and each releases the selection in its
 * cleanup.
 *
 * @example
 * ```ts
 * const threads = new ɵThreadSwitchCoordinator(core);
 * const selection = threads.select({ agent, threadId, explicit });
 * if (selection.shouldConnect) {
 *   threads.trackConnection(selection, async () => {
 *     await threads.whenTornDown();
 *     await core.connectAgent({ agent });
 *   });
 * }
 * // cleanup:
 * selection.release();
 * ```
 */
export class ɵThreadSwitchCoordinator {
  private currentSelection: ɵThreadSelection | null = null;
  private lastSelection: ɵThreadSelection | null = null;
  // Agent clones can share cursors. Every old reset finishes before a connect.
  private teardown: Promise<void> = Promise.resolve();
  private tornDown = true;
  private readonly detaches = new WeakMap<AbstractAgent, Promise<void>>();
  private readonly pendingConnections = new Map<AbstractAgent, Promise<void>>();
  private readonly failedConnections = new WeakSet<AbstractAgent>();

  /**
   * @param core - The CopilotKit core: stops a run on an inspector transition
   *   and reports connect failures.
   */
  constructor(
    private readonly core: Pick<CopilotKitCore, "stopAgent" | "subscribe">,
  ) {}

  /** The thread the chat shows now, or `null` before the first selection and after release. */
  get current() {
    const selection = this.currentSelection;
    return selection && !selection.isReleased ? selection : null;
  }

  /** Whether `selection` is the latest one. Release is tracked by the selection itself. */
  isCurrentSelection(selection: ɵThreadSelection) {
    return this.currentSelection === selection;
  }

  /**
   * Records the thread the chat now shows and pins it on the agent. Returns
   * the current selection unchanged when nothing about it changed, so a
   * framework re-running its effect for an unrelated reason starts no
   * second connect.
   */
  select(input: ɵThreadSelectionInput) {
    const inspectorRequestId = input.inspectorRequestId ?? null;
    const existing = this.current;
    const isUnchanged =
      existing !== null &&
      existing.agent === input.agent &&
      existing.threadId === input.threadId &&
      existing.explicit === input.explicit &&
      existing.inspectorRequestId === inspectorRequestId;
    if (existing && isUnchanged) return existing;

    const previous = this.lastSelection;
    const { agent, threadId, explicit } = input;
    const selection = new ɵThreadSelection(
      this,
      agent,
      threadId,
      explicit,
      inspectorRequestId,
    );
    this.currentSelection = selection;
    this.lastSelection = selection;
    this.failedConnections.delete(agent);

    const threadChanged = previous !== null && previous.threadId !== threadId;
    const discardedThreadId =
      previous?.agent === agent ? previous.threadId : agent.threadId;
    const isInspectorTransition =
      threadChanged &&
      previous.inspectorRequestId !== inspectorRequestId &&
      (previous.inspectorRequestId !== null || inspectorRequestId !== null);
    if (isInspectorTransition) {
      ɵstopAgentWithFallback(this.core, agent);
    }

    // Pin before anything issues a request: `connectAgent` reads
    // `agent.threadId` synchronously, and a non-explicit thread's first
    // `runAgent` must ship the id the chat renders.
    agent.threadId = threadId;

    if (!explicit && threadChanged) {
      this.resetForFreshThread(selection, previous, discardedThreadId);
    }
    return selection;
  }

  /**
   * Detaches the agent's active run, queued with the other teardowns. Reuses
   * a detach already in flight for the same agent. Never rejects: a failure is
   * logged.
   */
  detach(agent: AbstractAgent) {
    const inFlight = this.detaches.get(agent);
    if (inFlight) return inFlight;
    const detach = agent.detachActiveRun().catch((error: unknown) => {
      console.error("CopilotChat: detachActiveRun failed", error);
    });
    this.detaches.set(agent, detach);
    void detach.finally(() => {
      if (this.detaches.get(agent) === detach) this.detaches.delete(agent);
    });
    this.queueTeardown(detach);
    return detach;
  }

  /**
   * Adds work a connect must wait for, such as a framework-owned detach. A
   * rejection is logged and does not block later connects.
   */
  queueTeardown(work: Promise<unknown>) {
    this.setTeardown(
      Promise.all([this.teardown, work])
        .then(() => {})
        .catch((error: unknown) => {
          console.error("CopilotChat: thread teardown failed", error);
        }),
    );
  }

  /** Resolves once every queued detach and reset has finished. Never rejects. */
  whenTornDown() {
    return this.teardown;
  }

  /**
   * Whether every queued detach and reset has finished, so a connect can
   * start at once instead of waiting for {@link whenTornDown}.
   */
  get isTornDown() {
    return this.tornDown;
  }

  /**
   * Runs `connect` for the selection and remembers it, so a send can wait for
   * it ({@link waitForConnection}). A connect that throws, or that core
   * reports as failed for this agent and thread while the selection is
   * current, marks the agent's connection as failed. Returns the settled
   * connect, which never rejects.
   */
  trackConnection(
    selection: ɵThreadSelection,
    connect: () => Promise<unknown>,
  ) {
    const { agent } = selection;
    const connectingThreadId = agent.threadId;
    let failed = false;
    const subscription = this.core.subscribe({
      onError: (event) => {
        const isConnectFailure =
          event.code === CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED ||
          event.code === CopilotKitCoreErrorCode.AGENT_RUN_FAILED_EVENT;
        const isThisConnection =
          event.context?.agentId === agent.agentId &&
          (!event.context.threadId ||
            event.context.threadId === connectingThreadId);
        if (selection.isCurrent && isConnectFailure && isThisConnection) {
          failed = true;
        }
      },
    });
    const pending: Promise<void> = connect()
      .then(() => {})
      .catch((error: unknown) => {
        failed = true;
        console.error("CopilotChat: connection failed", error);
      })
      .finally(() => {
        subscription.unsubscribe();
        if (this.pendingConnections.get(agent) !== pending) return;
        this.pendingConnections.delete(agent);
        if (!selection.isCurrent) return;
        if (failed) this.failedConnections.add(agent);
        else this.failedConnections.delete(agent);
      });
    this.pendingConnections.set(agent, pending);
    return pending;
  }

  /**
   * Waits for the connection the chat started for `selection`'s agent.
   * `"stale"` when the selection stopped being current meanwhile, `"failed"`
   * when the thread did not load, `"ready"` otherwise.
   */
  async waitForConnection(selection: ɵThreadSelection) {
    let connection = this.pendingConnections.get(selection.agent);
    while (connection && selection.isCurrent) {
      await connection;
      connection = this.pendingConnections.get(selection.agent);
    }
    let result: ɵConnectionWaitResult = "ready";
    if (!selection.isCurrent) result = "stale";
    else if (this.failedConnections.has(selection.agent)) result = "failed";
    return result;
  }

  /** Releases the current selection. Pending resets and connects stop applying. */
  dispose() {
    this.currentSelection?.release();
    this.currentSelection = null;
  }

  private resetForFreshThread(
    selection: ɵThreadSelection,
    previous: ɵThreadSelection,
    discardedThreadId: string | undefined,
  ) {
    const { agent } = selection;
    let resetPending = true;
    const clearCursor = () => {
      if (discardedThreadId) ɵclearAgentThreadCursors(agent, discardedThreadId);
    };
    const clearDiscardedBaseline = () => {
      if (!selection.isCurrent || !resetPending) return;
      ɵresetAgentThreadBaseline(agent, { cursorThreadId: discardedThreadId });
    };
    if (previous.agent === agent) {
      previous.setDiscardedBaselineReset(clearDiscardedBaseline);
    }
    // Queues the detach; the reset below runs after it and every earlier teardown.
    this.detach(agent);
    clearDiscardedBaseline();
    this.setTeardown(
      this.teardown
        .then(() => {
          if (!resetPending) return;
          // The cursor belongs to the discarded view, even after a fast reopen.
          clearCursor();
          clearDiscardedBaseline();
          resetPending = false;
        })
        .catch((error: unknown) => {
          console.error("CopilotChat: thread reset failed", error);
        }),
    );
  }

  // Each teardown chains the one before it, so the latest settling means all
  // of them have.
  private setTeardown(teardown: Promise<void>) {
    this.teardown = teardown;
    this.tornDown = false;
    void teardown.then(() => {
      if (this.teardown === teardown) this.tornDown = true;
    });
  }
}
