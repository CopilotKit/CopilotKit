import { AbstractAgent, AGUIConnectNotImplementedError } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { randomUUID } from "@copilotkit/shared";
import type { CopilotKitCore } from "../core/core";
import { CopilotKitCoreErrorCode } from "../core/core";
import { ɵresetAgentThreadBaseline } from "../core/thread-baseline";
import { isRunCompletionAware } from "../intelligence-agent";
import { ɵisHttpAgent } from "../utils/http-agent";
import type { ɵThreadSelection, ɵThreadSelectionInput } from "./thread-switch";
import { ɵThreadSwitchCoordinator } from "./thread-switch";

/** An error core reported, as a chat's `onError` receives it. */
export interface ɵChatErrorEvent {
  error: Error;
  code: CopilotKitCoreErrorCode;
  context: Record<string, unknown>;
}

/**
 * Calls `handler` for every core error that belongs to `agentId`, and for
 * errors that name no agent. Core awaits its subscribers, so the handler's
 * promise is not awaited: a slow handler must not hold up the run that
 * reported the error. Returns the unsubscribe.
 */
export function ɵsubscribeToAgentErrors(
  core: Pick<CopilotKitCore, "subscribe">,
  agentId: string,
  handler: (event: ɵChatErrorEvent) => unknown,
) {
  const subscription = core.subscribe({
    onError: (event) => {
      const eventAgentId = event.context.agentId;
      if (eventAgentId && eventAgentId !== agentId) return;
      void handler({
        error: event.error,
        code: event.code,
        context: event.context,
      });
    },
  });
  return () => subscription.unsubscribe();
}

/**
 * The thread a chat shows when no caller picked one: a locally minted id.
 * The id stays the same while no thread is provided, and a new one is minted
 * each time a provided thread goes away, so removing a thread starts a fresh
 * one instead of returning to an older fresh thread.
 *
 * {@link resolve} returns the same id for the same input, so a framework can
 * call it while it renders.
 */
export class ɵFreshThreadId {
  private generated = randomUUID();
  private lastProvided: string | undefined;

  /** `providedThreadId` when set, else the fresh thread's id. */
  resolve(providedThreadId: string | undefined) {
    if (providedThreadId) {
      this.lastProvided = providedThreadId;
      return providedThreadId;
    }
    if (this.lastProvided !== undefined) {
      this.lastProvided = undefined;
      this.generated = randomUUID();
    }
    return this.generated;
  }
}

/**
 * Whether `agent` can load a thread from its backend: it overrides AG-UI's
 * `connect` or `connectAgent`. The base versions only throw
 * `AGUIConnectNotImplementedError`.
 */
export function ɵimplementsConnect(agent: AbstractAgent) {
  const base = AbstractAgent.prototype;
  return (
    Reflect.get(agent, "connect") !== Reflect.get(base, "connect") ||
    Reflect.get(agent, "connectAgent") !== Reflect.get(base, "connectAgent")
  );
}

/** What {@link ɵChatConnection} works with. */
export interface ɵChatConnectionOptions {
  /** The CopilotKit core that connects, stops and reports errors. */
  core: Pick<CopilotKitCore, "connectAgent" | "stopAgent" | "subscribe">;
  /**
   * Called when the thread an Inspector override shows fails to load, so the
   * override ends and the chat returns to its own thread.
   */
  onInspectorOverrideFailed?: (requestId: string) => void;
  /**
   * Runs `callback` once the view has painted what a connect applied. The
   * default is the next animation frame (16 ms where there is none), so the
   * chat stops showing "connecting" only after the restored messages render.
   */
  afterPaint?: (callback: () => void) => void;
}

/** Hooks for one connect, for framework state such as React's run-activity reconnects. */
export interface ɵChatConnectHooks {
  /** Called when the connect starts, before it waits for earlier teardowns. */
  onStart?: () => void;
  /**
   * Called when the connect has settled. `current` is `false` when the chat
   * released the thread before the connect settled.
   */
  onSettled?: (current: boolean) => void;
}

/** What a chat's connection shows. */
export interface ɵChatConnectionSnapshot {
  /** The last thread whose connect settled (succeeded or failed), or `null`. */
  connectedThreadId: string | null;
}

/** The thread a chat shows, from {@link ɵChatConnection.open}. */
export interface ɵChatConnectionHandle {
  /** The selection the chat shows. */
  readonly selection: ɵThreadSelection;
  /**
   * Stops showing the thread. A connect still loading is aborted and its run
   * detached. A run that started after the connect, or that took over its
   * pipeline, is left running. Safe to call more than once.
   */
  release(): void;
}

function defaultAfterPaint(callback: () => void) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => callback());
  } else {
    setTimeout(callback, 16);
  }
}

/**
 * The connect side of a chat: keeps the agent on the thread the chat shows
 * and loads that thread from the backend. Owns the rules all three
 * frameworks share:
 *
 * - Only a thread a caller picked (explicit) is connected. A locally minted
 *   thread has never reached the backend, so `/connect` would 404.
 * - A connect waits for the previous thread's teardown, and a send waits for
 *   the connect ({@link threads}).
 * - An `HttpAgent` connect gets its own `AbortController`, aborted when the
 *   chat leaves the thread before the connect settles.
 * - Leaving a thread detaches the agent's run only while that run is the
 *   connect's own. A run the user started after the connect keeps running.
 * - An agent that does not implement connect is not connected, and its
 *   thread counts as loaded at once. On the agent's first thread its
 *   messages stay, so a message sent right after mount survives. A move
 *   from another thread detaches the old thread's run and empties the agent,
 *   as a connect would. An `AGUIConnectNotImplementedError` from a connect
 *   is not an error.
 * - A failed connect of an Inspector override ends the override.
 * - The chat shows "connecting" for an explicit thread until its connect has
 *   settled and painted ({@link isConnecting}).
 *
 * @example
 * ```ts
 * const connection = new ɵChatConnection({ core, onInspectorOverrideFailed });
 * const handle = connection.open({ agent, threadId, explicit: true });
 * connection.isConnecting({ threadId, explicit: true }); // true until settled
 * // cleanup:
 * handle.release();
 * ```
 */
export class ɵChatConnection {
  /** The thread coordinator; a chat submitter waits on its connections. */
  readonly threads: ɵThreadSwitchCoordinator;
  private snapshot: ɵChatConnectionSnapshot = { connectedThreadId: null };
  private readonly listeners = new Set<() => void>();
  private readonly afterPaint: (callback: () => void) => void;
  /** The thread each agent showed last, to tell a thread switch from a first open. */
  private readonly openedThreads = new WeakMap<AbstractAgent, string>();

  constructor(private readonly options: ɵChatConnectionOptions) {
    this.threads = new ɵThreadSwitchCoordinator(options.core);
    this.afterPaint = options.afterPaint ?? defaultAfterPaint;
  }

  /** The last connected thread. Keeps its identity until it changes. */
  getSnapshot() {
    return this.snapshot;
  }

  /** Calls `listener` after every snapshot change. Returns the unsubscribe. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Whether the chat waits for `threadId` to load: an explicit thread whose
   * connect has not settled yet. Pure, so a framework can call it while it
   * renders, before {@link open} has run for a new thread.
   */
  isConnecting({
    threadId,
    explicit,
  }: {
    threadId: string;
    explicit: boolean;
  }) {
    return explicit && this.snapshot.connectedThreadId !== threadId;
  }

  /**
   * Shows a thread: selects it on the coordinator (pinning `agent.threadId`)
   * and, for an explicit thread, connects it. Release the handle when the
   * chat moves on or unmounts.
   */
  open(
    input: ɵThreadSelectionInput,
    hooks: ɵChatConnectHooks = {},
  ): ɵChatConnectionHandle {
    const previousThreadId = this.openedThreads.get(input.agent);
    const selection = this.threads.select(input);
    this.openedThreads.set(selection.agent, selection.threadId);
    if (!selection.shouldConnect) {
      return { selection, release: () => selection.release() };
    }
    if (!ɵimplementsConnect(selection.agent)) {
      if (
        previousThreadId !== undefined &&
        previousThreadId !== input.threadId
      ) {
        this.clearSwitchedThread(selection);
      }
      this.setConnectedThreadId(selection.threadId);
      return { selection, release: () => selection.release() };
    }
    return this.connect(selection, hooks);
  }

  /**
   * Runs `connect` as a connection of the current thread, so a send waits for
   * it. With no current thread it just runs, and a failure is logged.
   */
  track(connect: () => Promise<unknown>) {
    const selection = this.threads.current;
    if (selection) return this.threads.trackConnection(selection, connect);
    return connect()
      .then(() => {})
      .catch((error: unknown) => {
        console.error("CopilotChat: connection failed", error);
      });
  }

  /** Releases the current thread and drops the listeners. */
  dispose() {
    this.threads.dispose();
    this.listeners.clear();
  }

  /**
   * What a connect does when an agent without `connect` moves to another
   * thread: detaches the old thread's run and empties the agent. The reset
   * runs again once the detach and every earlier teardown finished, and a
   * send waits for it, so nothing of the old thread lands on the new one.
   */
  private clearSwitchedThread(selection: ɵThreadSelection) {
    const { agent, threadId } = selection;
    const reset = () => {
      if (selection.isCurrent) {
        ɵresetAgentThreadBaseline(agent, { cursorThreadId: threadId });
      }
    };
    void this.threads.detach(agent);
    reset();
    void this.threads.trackConnection(selection, async () => {
      await this.threads.whenTornDown();
      reset();
    });
  }

  private setConnectedThreadId(threadId: string) {
    if (this.snapshot.connectedThreadId === threadId) return;
    this.snapshot = { connectedThreadId: threadId };
    for (const listener of this.listeners) listener();
  }

  private connect(
    selection: ɵThreadSelection,
    hooks: ɵChatConnectHooks,
  ): ɵChatConnectionHandle {
    const { core, onInspectorOverrideFailed } = this.options;
    const { agent, threadId, inspectorRequestId } = selection;
    const controller = new AbortController();
    // Armed right before `connectAgent`, so a run that started earlier (a
    // tool follow-up from the previous thread, an app's `runAgent`) is not
    // taken for the connect's run.
    let ownership: ConnectOwnership | undefined;
    let released = false;
    let settled = false;

    const failInspectorOverride = () => {
      if (inspectorRequestId) onInspectorOverrideFailed?.(inspectorRequestId);
    };
    // Core reports most connect failures as errors instead of throwing.
    const inspectorErrors = inspectorRequestId
      ? core.subscribe({
          onError: (event) => {
            const isThisThread =
              event.code === CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED &&
              event.context.agentId === agent.agentId &&
              event.context.threadId === threadId;
            if (isThisThread && !released) failInspectorOverride();
          },
        })
      : undefined;

    hooks.onStart?.();
    void this.threads
      .trackConnection(selection, async () => {
        try {
          await this.threads.whenTornDown();
          if (released) return;
          // `connectAgent` keeps the agent's controller, unlike `runAgent`.
          if (ɵisHttpAgent(agent)) agent.abortController = controller;
          ownership = new ConnectOwnership(agent);
          await core.connectAgent({ agent });
        } catch (error) {
          if (released || error instanceof AGUIConnectNotImplementedError) {
            return;
          }
          failInspectorOverride();
          // The coordinator logs the failure and blocks sends on it.
          throw error;
        }
      })
      .finally(() => {
        settled = true;
        ownership?.stopWatching();
        if (released) {
          // The user moved on to a fresh thread while this one loaded:
          // clear what it applied so the fresh thread shows empty.
          selection.clearDiscardedBaseline();
        } else {
          this.afterPaint(() => {
            if (!released) this.setConnectedThreadId(threadId);
          });
        }
        hooks.onSettled?.(!released);
      });

    return {
      selection,
      release: () => {
        if (released) return;
        released = true;
        selection.release();
        inspectorErrors?.unsubscribe();
        // Before the connect is armed it has started no run to detach.
        const ownsRun = !settled && ownership?.ownsActiveRun() === true;
        // A connect that settled no longer owns the controller unless a run
        // replaced it; a successor connect may still be using it.
        const ownsController =
          ownership?.replaced !== true &&
          (!settled ||
            (ɵisHttpAgent(agent) && agent.abortController !== controller));
        if (ownsController) controller.abort();
        ownership?.stopWatching();
        if (ownsRun) void this.threads.detach(agent);
      },
    };
  }
}

/**
 * Tells whether the agent's active run is still the pipeline a connect
 * started, or whether another run replaced it. It watches from the moment it
 * is created, and takes the first run that initializes after that for the
 * connect's own, so create it right before the connect starts.
 */
class ConnectOwnership {
  /** Set when another run initialized on the agent after the connect's own. */
  replaced = false;
  private initialized: RunAgentInput | undefined;
  private completion: Promise<void> | undefined;
  private refresh: ReturnType<typeof setTimeout> | undefined;
  private readonly subscription: { unsubscribe(): void };

  constructor(private readonly agent: AbstractAgent) {
    this.subscription = agent.subscribe({
      onRunInitialized: ({ input }) => {
        if (this.initialized && input !== this.initialized) {
          this.replaced = true;
          return;
        }
        this.initialized = input;
        // AG-UI installs the pipeline after initialization subscribers finish.
        this.refresh = setTimeout(() => this.isOwnPipeline(), 0);
      },
      onRunStartedEvent: () => {
        this.isOwnPipeline();
      },
    });
  }

  /** Whether detaching the agent stops only the connect's own run. */
  ownsActiveRun() {
    return this.isOwnPipeline() || !this.initialized;
  }

  stopWatching() {
    clearTimeout(this.refresh);
    this.subscription.unsubscribe();
  }

  private isOwnPipeline() {
    if (!this.initialized || this.replaced) return false;
    const candidate: unknown = this.agent;
    const current = isRunCompletionAware(candidate)
      ? candidate.activeRunCompletionPromise
      : undefined;
    if (!current) return false;
    this.completion ??= current;
    return current === this.completion;
  }
}
