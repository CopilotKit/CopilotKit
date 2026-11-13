import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/client";
import type {
  AbstractAgent,
  AgentSubscriber,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import type { CopilotKitIntelligence } from "../intelligence-platform";
import type { AcquireThreadLockRequest } from "../intelligence-platform/client";
import { startThreadLockHeartbeat } from "../intelligence-platform/thread-lock-heartbeat";
import type { AgentRunner } from "../runner/agent-runner";
import { IntelligenceAgentRunner } from "../runner/intelligence";

/** Lock TTL used when the runtime passed in does not set one. */
const DEFAULT_LOCK_TTL_SECONDS = 20;
/** Lock renewal interval used when the runtime passed in does not set one. */
const DEFAULT_LOCK_HEARTBEAT_INTERVAL_SECONDS = 15;

/** How a Thread lock is held: its lifetime, its renewal interval, its key. */
export interface ThreadLockSettings {
  ttlSeconds: number;
  heartbeatIntervalSeconds: number;
  keyPrefix?: string;
}

/** What a locked run sends, decided once the lock is held. */
export interface LockedRunStart {
  /** The agent the runner runs. Aborted when the run is stopped. */
  agent: AbstractAgent;
  /** The run's input. Its `threadId` and `runId` are replaced by the lock's. */
  input: RunAgentInput;
  /** The input messages Intelligence stores; the runner defaults to all of them. */
  persistedInputMessages?: Message[];
}

/** How a locked run ended, when it ended without a transport failure. */
export interface LockedRunOutcome {
  /** The Thread ID Intelligence issued with the lock. */
  threadId: string;
  /** The run ID Intelligence issued with the lock. */
  runId: string;
  /** The `RUN_ERROR` the run ended with, if it failed. */
  runError?: BaseEvent;
  /** The renewal failure that lost the lock, if it was lost. */
  lockLost?: { error: unknown };
  /** True when the run was stopped through `signal`. */
  stopped: boolean;
}

/** Everything {@link runWithThreadLock} needs to hold a lock around one run. */
export interface LockedRunArgs {
  runner: AgentRunner;
  intelligence: CopilotKitIntelligence;
  lock: ThreadLockSettings;
  /** The lock request, without the settings in `lock`. */
  acquire: Omit<AcquireThreadLockRequest, "ttlSeconds" | "lockKeyPrefix">;
  /**
   * Prepares the run once the lock is held, with the Thread and run IDs the
   * lock issued. The lock is renewed while it runs and released if it throws.
   */
  start(canonical: {
    threadId: string;
    runId: string;
  }): LockedRunStart | Promise<LockedRunStart>;
  /** Stops the run when it aborts. The stop is recorded with Intelligence. */
  signal?: AbortSignal;
  /**
   * How long to wait for the run to end once it has been asked to stop. When
   * it has not ended by then the lock is released anyway and the call rejects
   * with a {@link ThreadRunError} whose reason is `"stop_timeout"`. Unset, the
   * call waits for the runner.
   */
  stopTimeoutMs?: number;
  /** Called once, as soon as the lock is lost and before the run is stopped. */
  onLockLost?: (error: unknown) => void;
}

/**
 * Hold a Thread's lock around one run: acquire it, renew it while the run
 * works, stop the run if the lock is lost or `signal` aborts, and release it
 * on every path once the runner's stream has ended.
 *
 * Shared by managed Channel runs and {@link runAgentInThread}.
 *
 * @throws The lock request's error when the lock is refused, an error thrown
 *   by `start`, the runner's stream error, or a {@link ThreadRunError} with
 *   reason `"stop_timeout"`. The lock is released in every case where it was
 *   acquired.
 */
export async function runWithThreadLock(
  args: LockedRunArgs,
): Promise<LockedRunOutcome> {
  const { runner, intelligence, lock: settings } = args;
  // The platform starts the lock's TTL when it handles the request, so time
  // the lifetime from the send rather than from the response.
  const lockRequestedAt = Date.now();
  const lock = await intelligence.ɵacquireThreadLock({
    ...args.acquire,
    ttlSeconds: settings.ttlSeconds,
    ...(settings.keyPrefix !== undefined
      ? { lockKeyPrefix: settings.keyPrefix }
      : {}),
  });
  const threadId = lock.threadId || args.acquire.threadId;
  const runId = lock.runId || args.acquire.runId;

  let agent: AbstractAgent | undefined;
  let stopPromise: Promise<boolean | undefined> | undefined;
  let lockLost: { error: unknown } | undefined;
  let stoppedBySignal = false;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let failStop: ((error: Error) => void) | undefined;

  const stopRun = (): void => {
    try {
      agent?.abortRun();
    } catch {
      // The exact runner stop remains the authoritative cancellation path.
    }
    stopPromise ??= Promise.resolve()
      .then(() => runner.stop({ threadId, runId }))
      .catch(() => false);
    if (args.stopTimeoutMs !== undefined && stopTimer === undefined) {
      stopTimer = setTimeout(() => {
        failStop?.(
          new ThreadRunError(
            "stop_timeout",
            `The run did not end within ${args.stopTimeoutMs}ms of being stopped`,
            { threadId, runId },
          ),
        );
      }, args.stopTimeoutMs);
      stopTimer.unref?.();
    }
  };
  // A signal that aborts goes nowhere near Intelligence's own run stop, so
  // this runtime records it. A lost lock also stops the run, but that is a
  // failure rather than a cancellation, so it records nothing.
  const stopBySignal = (): void => {
    stoppedBySignal = true;
    stopRun();
  };

  const heartbeat = startThreadLockHeartbeat({
    renew: (signal) =>
      intelligence.ɵrenewThreadLock({
        threadId,
        runId,
        ttlSeconds: settings.ttlSeconds,
        ...(settings.keyPrefix !== undefined
          ? { lockKeyPrefix: settings.keyPrefix }
          : {}),
        signal,
      }),
    intervalMs: settings.heartbeatIntervalSeconds * 1_000,
    fallbackTtlSeconds: settings.ttlSeconds,
    initialTtlSeconds:
      lock.ttlSeconds === undefined
        ? undefined
        : lock.ttlSeconds - (Date.now() - lockRequestedAt) / 1_000,
    unref: true,
    onLost: (error) => {
      lockLost = { error };
      try {
        args.onLockLost?.(error);
      } catch {
        // A caller's observer must not keep the run from being stopped.
      }
      stopRun();
    },
  });

  let runError: BaseEvent | undefined;
  try {
    const started = await args.start({ threadId, runId });
    agent = started.agent;
    // The lock was lost while the run was being prepared: nothing ran, so
    // there is nothing to stop.
    if (lockLost) return { threadId, runId, lockLost, stopped: false };

    args.signal?.addEventListener("abort", stopBySignal, { once: true });
    await new Promise<void>((resolve, reject) => {
      failStop = reject;
      const stream = runner.run({
        threadId,
        ...(lock.backendThreadId === undefined
          ? {}
          : { backendThreadId: lock.backendThreadId }),
        agent: started.agent,
        input: { ...started.input, threadId, runId },
        ...(started.persistedInputMessages !== undefined
          ? { persistedInputMessages: started.persistedInputMessages }
          : {}),
        recordStop: (signal) =>
          stoppedBySignal
            ? intelligence.ɵrecordRunStop({
                threadId,
                runId,
                userId: args.acquire.userId,
                agentId: args.acquire.agentId,
                signal,
              })
            : Promise.resolve(),
      });
      stream.subscribe({
        next: (event: BaseEvent) => {
          if (event.type === EventType.RUN_ERROR) runError ??= event;
        },
        // Once the lock is lost, Intelligence refuses the run's remaining
        // events, so the stream failing is the lost lock, not a second fault.
        error: (error: unknown) => (lockLost ? resolve() : reject(error)),
        complete: () => resolve(),
      });
      if (args.signal?.aborted) stopBySignal();
    });
  } finally {
    args.signal?.removeEventListener("abort", stopBySignal);
    heartbeat.stop();
    if (stopTimer !== undefined) clearTimeout(stopTimer);
    // Always release the lock from the runtime side. The gateway also
    // releases it when it stores the run's terminal event; the release is a
    // compare-and-delete by run ID, so a second one changes nothing and never
    // frees a lock a newer run holds.
    await intelligence
      .ɵcleanupThreadLock({ threadId, runId })
      .catch(() => undefined);
  }

  if (lockLost) await stopPromise;
  return {
    threadId,
    runId,
    ...(runError ? { runError } : {}),
    ...(lockLost ? { lockLost } : {}),
    stopped: stoppedBySignal,
  };
}

/** Why a {@link runAgentInThread} call failed after its run was started. */
export type ThreadRunErrorReason =
  /** The agent ended the run with a `RUN_ERROR`. */
  | "run_failed"
  /** The Thread's lock could not be renewed, so the run was stopped. */
  | "lock_lost"
  /** The run was stopped and did not end within `stopTimeoutMs`. */
  | "stop_timeout";

/**
 * A run that {@link runAgentInThread} started and that did not finish. The
 * lock has been released by the time it is thrown.
 */
export class ThreadRunError extends Error {
  readonly reason: ThreadRunErrorReason;
  /** The Thread the run belongs to. */
  readonly threadId: string;
  /** The run, as Intelligence issued it with the lock. */
  readonly runId: string;
  /** The `RUN_ERROR` event's `code`, for a failed run that sent one. */
  readonly code?: string;

  constructor(
    reason: ThreadRunErrorReason,
    message: string,
    details: {
      threadId: string;
      runId: string;
      code?: string;
      cause?: unknown;
    },
  ) {
    super(
      message,
      details.cause === undefined ? undefined : { cause: details.cause },
    );
    this.name = "ThreadRunError";
    this.reason = reason;
    this.threadId = details.threadId;
    this.runId = details.runId;
    if (details.code !== undefined) this.code = details.code;
  }
}

/**
 * The runtime a {@link runAgentInThread} call runs through. A `CopilotRuntime`
 * configured with `intelligence` is one; so is an Intelligence client on its
 * own, `{ intelligence }`.
 */
export interface RunAgentInThreadRuntime {
  /** The Intelligence client that holds the Thread and issues its lock. */
  intelligence?: CopilotKitIntelligence;
  /**
   * The runner that streams the run's events to Intelligence. Omitted, the
   * run uses one Intelligence runner per client, created on first use and
   * shared by every later run, so a Thread already running in this process
   * is refused at once.
   */
  runner?: AgentRunner;
  /** Lock TTL in seconds. @default 20 */
  lockTtlSeconds?: number;
  /** Interval in seconds at which the lock is renewed. @default 15 */
  lockHeartbeatIntervalSeconds?: number;
  /** Custom key prefix for the thread lock. */
  lockKeyPrefix?: string;
}

/** Options for {@link runAgentInThread}. */
export interface RunAgentInThreadOptions {
  /** The runtime to run through, usually your `CopilotRuntime`. */
  runtime: RunAgentInThreadRuntime;
  /**
   * The agent to run. It is run in place: its messages are replaced by the
   * run's conversation and the run's output is applied to it, so pass an
   * instance no other run is using.
   */
  agent: AbstractAgent;
  /** The agent's ID, as the Thread records it. */
  agentId: string;
  /** The Thread to run in. It is created if it does not exist yet. */
  threadId: string;
  /** The user the Thread belongs to and the run acts for. */
  userId: string;
  /**
   * The run's ID. Intelligence may issue a different one with the lock; the
   * result carries the one it issued. @default a random UUID
   */
  runId?: string;
  /**
   * The run's input. An array is this run's new messages, appended to the
   * Thread's stored history. A function receives that history, converted to
   * AG-UI messages, and the Thread and run IDs the lock issued, and returns
   * the whole conversation the agent sees. Unless `persistedInputMessages`
   * says otherwise, only messages whose IDs the Thread does not already hold
   * are stored.
   */
  messages?:
    | Message[]
    | ((
        history: Message[],
        run: { threadId: string; runId: string },
      ) => Message[] | Promise<Message[]>);
  /**
   * The input messages the Thread stores for this run, when that is not the
   * new part of the conversation: for example a short request on record
   * while the agent is sent a longer brief. A function receives the Thread
   * and run IDs the lock issued.
   */
  persistedInputMessages?:
    | Message[]
    | ((run: { threadId: string; runId: string }) => Message[]);
  /** Tools offered to the agent for this run. */
  tools?: RunAgentInput["tools"];
  /** Context passed to the agent for this run. */
  context?: RunAgentInput["context"];
  /** Properties forwarded to the agent with the run. */
  forwardedProps?: RunAgentInput["forwardedProps"];
  /** Answers to the interrupts the Thread's previous run left open. */
  resume?: RunAgentInput["resume"];
  /** Learning Container to assign the Thread to when it is created and locked. */
  learningContainerId?: string;
  /** The app's analytics context, which Intelligence records with the run. */
  analyticsContext?: Record<string, unknown>;
  /**
   * The request the run belongs to. Runs of one request (a follow-up, a
   * resume) send the same ID so the platform counts the request once.
   */
  requestId?: string;
  /**
   * Receives the agent's events while the run works, for example to show a
   * reply as it is written.
   */
  subscriber?: AgentSubscriber;
  /**
   * Stops the run when it aborts. The stop is recorded with Intelligence, so
   * the run reads as stopped rather than finished, and the call resolves with
   * `stopped: true` once the runner has ended the run. Use
   * `AbortSignal.timeout()` for a deadline.
   */
  signal?: AbortSignal;
  /**
   * How long to wait for the run to end once it has been stopped, by
   * `signal` or by a lost lock. Past it, the lock is released and the call
   * rejects with a {@link ThreadRunError} whose reason is `"stop_timeout"`.
   * Unset, the call waits for the runner.
   */
  stopTimeoutMs?: number;
  /**
   * Called once, as soon as the Thread's lock is lost and before the run is
   * stopped, so a caller can tell this stop from one somebody else made. The
   * call still rejects with a {@link ThreadRunError} whose reason is
   * `"lock_lost"` once the run has ended.
   */
  onLockLost?: (error: unknown) => void;
}

/** What a finished {@link runAgentInThread} call returns. */
export interface RunAgentInThreadResult {
  /** The Thread the run belongs to. */
  threadId: string;
  /** The run, as Intelligence issued it with the lock. */
  runId: string;
  /** The messages the run added to the conversation, in order. */
  newMessages: Message[];
  /** True when `signal` stopped the run before it finished on its own. */
  stopped: boolean;
}

/**
 * Run an agent in an Intelligence Thread with no client attached: a
 * scheduled run, a hand-off from another agent, or a run that resumes once a
 * person answers. The run is stored in the Thread as a browser's run is, so
 * the person sees it when they open the Thread.
 *
 * The Thread is created if it does not exist. The run holds the Thread's
 * lock from before its first event until the runner's stream has ended,
 * renews it while the agent works, and releases it on every path, so a run
 * never leaves its Thread locked. A Thread another run holds refuses the call
 * with a `PlatformRequestError` whose status is 409, before anything runs.
 *
 * @example
 * ```ts
 * import { randomUUID } from "node:crypto";
 * import { runAgentInThread } from "@copilotkit/runtime/v2";
 *
 * const { newMessages } = await runAgentInThread({
 *   runtime,
 *   agent: new BuiltInAgent({ model: "openai/gpt-5.4" }),
 *   agentId: "assistant",
 *   threadId,
 *   userId,
 *   messages: [{ id: randomUUID(), role: "user", content: "Summarise today" }],
 *   signal: AbortSignal.timeout(5 * 60_000),
 * });
 * ```
 *
 * @throws A `PlatformRequestError` when Intelligence refuses the Thread or
 *   its lock; a {@link ThreadRunError} when the run fails, loses its lock, or
 *   does not end within `stopTimeoutMs` of being stopped; `signal.reason`
 *   when `signal` is already aborted, before anything is sent.
 */
export async function runAgentInThread(
  options: RunAgentInThreadOptions,
): Promise<RunAgentInThreadResult> {
  const { runtime, agent, agentId, userId } = options;
  const intelligence = runtime.intelligence;
  if (!intelligence) {
    throw new Error(
      "runAgentInThread requires a runtime configured with `intelligence`",
    );
  }
  options.signal?.throwIfAborted();
  const learning =
    options.learningContainerId !== undefined
      ? { learningContainerId: options.learningContainerId }
      : {};

  // No client created the Thread, so the run creates it.
  await intelligence.getOrCreateThread({
    threadId: options.threadId,
    userId,
    agentId,
    ...learning,
  });

  const runner = runtime.runner ?? sharedRunnerFor(intelligence);
  let before = new Set<string>();
  const subscription = options.subscriber
    ? agent.subscribe(options.subscriber)
    : undefined;
  const outcome = await runWithThreadLock({
    runner,
    intelligence,
    lock: {
      ttlSeconds: runtime.lockTtlSeconds ?? DEFAULT_LOCK_TTL_SECONDS,
      heartbeatIntervalSeconds:
        runtime.lockHeartbeatIntervalSeconds ??
        DEFAULT_LOCK_HEARTBEAT_INTERVAL_SECONDS,
      ...(runtime.lockKeyPrefix !== undefined
        ? { keyPrefix: runtime.lockKeyPrefix }
        : {}),
    },
    acquire: {
      supportsBackendThreadId: true,
      threadId: options.threadId,
      runId: options.runId ?? randomUUID(),
      userId,
      agentId,
      ...learning,
      ...(options.requestId !== undefined
        ? { requestId: options.requestId }
        : {}),
      ...(options.analyticsContext !== undefined
        ? { analyticsContext: options.analyticsContext }
        : {}),
    },
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.stopTimeoutMs !== undefined
      ? { stopTimeoutMs: options.stopTimeoutMs }
      : {}),
    ...(options.onLockLost ? { onLockLost: options.onLockLost } : {}),
    start: async ({ threadId, runId }) => {
      // Read once the lock is held, so no other run can add to the Thread
      // between this read and the run.
      const stored = await intelligence.getThreadMessages({ threadId, userId });
      const history = await Promise.all(
        stored.messages.map((message) => toAgentMessage(message, intelligence)),
      );
      const conversation =
        typeof options.messages === "function"
          ? await options.messages(history, { threadId, runId })
          : [...history, ...(options.messages ?? [])];
      const historic = new Set(stored.messages.map((message) => message.id));
      // AG-UI agents build a run's input from their own Thread ID, messages
      // and state, so the conversation goes on the agent.
      agent.threadId = threadId;
      agent.setMessages(conversation);
      before = new Set(conversation.map((message) => message.id));
      return {
        agent,
        input: {
          threadId,
          runId,
          messages: conversation,
          state: agent.state,
          tools: options.tools ?? [],
          context: options.context ?? [],
          forwardedProps: options.forwardedProps,
          ...(options.resume !== undefined ? { resume: options.resume } : {}),
        },
        persistedInputMessages:
          typeof options.persistedInputMessages === "function"
            ? options.persistedInputMessages({ threadId, runId })
            : (options.persistedInputMessages ??
              conversation.filter((message) => !historic.has(message.id))),
      };
    },
  }).finally(() => subscription?.unsubscribe());

  const { threadId, runId } = outcome;
  if (outcome.runError) {
    const event = outcome.runError as BaseEvent & {
      message?: unknown;
      code?: unknown;
    };
    throw new ThreadRunError(
      "run_failed",
      typeof event.message === "string" && event.message.length > 0
        ? event.message
        : "The agent run failed",
      {
        threadId,
        runId,
        ...(typeof event.code === "string" && event.code.length > 0
          ? { code: event.code }
          : {}),
      },
    );
  }
  if (outcome.lockLost) {
    throw new ThreadRunError(
      "lock_lost",
      "The Thread's lock could not be renewed, so the run was stopped",
      { threadId, runId, cause: outcome.lockLost.error },
    );
  }
  return {
    threadId,
    runId,
    newMessages: agent.messages.filter((message) => !before.has(message.id)),
    stopped: outcome.stopped,
  };
}

/** One runner per Intelligence client, for runs given no runner of their own. */
const sharedRunners = new WeakMap<CopilotKitIntelligence, AgentRunner>();

function sharedRunnerFor(intelligence: CopilotKitIntelligence): AgentRunner {
  let runner = sharedRunners.get(intelligence);
  if (!runner) {
    runner = new IntelligenceAgentRunner({
      url: intelligence.ɵgetRunnerWsUrl(),
      authToken: intelligence.ɵgetRunnerAuthToken(),
    });
    sharedRunners.set(intelligence, runner);
  }
  return runner;
}

/** Convert canonical Intelligence history into AG-UI messages. */
export async function toAgentMessage(
  message: {
    id: string;
    role: string;
    activityType?: string;
    content?: unknown;
    toolCalls?: Array<{ id: string; name: string; args: string }>;
    toolCallId?: string;
  },
  intelligence: CopilotKitIntelligence,
): Promise<Message> {
  const content = await hydrateManagedContent(message.content, intelligence);
  return {
    id: message.id,
    role: message.role as Message["role"],
    content: content ?? "",
    ...(message.activityType ? { activityType: message.activityType } : {}),
    ...(message.toolCalls
      ? {
          toolCalls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.name, arguments: call.args },
          })),
        }
      : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
  } as Message;
}

/** Resolves managed asset references only at the authorized Runtime boundary. */
async function hydrateManagedContent(
  content: unknown,
  intelligence: CopilotKitIntelligence,
): Promise<unknown> {
  if (Array.isArray(content)) {
    return Promise.all(
      content.map(async (part) => {
        if (
          typeof part !== "object" ||
          part === null ||
          !("source" in part) ||
          typeof part.source !== "object" ||
          part.source === null ||
          !("value" in part.source) ||
          typeof part.source.value !== "string" ||
          !part.source.value.startsWith("cpki-asset://")
        ) {
          return part;
        }
        const assetId = part.source.value.slice("cpki-asset://".length);
        const asset = await intelligence.ɵgetManagedChannelAsset(assetId);
        return {
          ...part,
          source: {
            type: "data",
            value: Buffer.from(asset.bytes).toString("base64"),
            mimeType:
              asset.mimeType ??
              ("mimeType" in part.source &&
              typeof part.source.mimeType === "string"
                ? part.source.mimeType
                : "application/octet-stream"),
          },
        };
      }),
    );
  }

  if (
    typeof content === "object" &&
    content !== null &&
    "assetId" in content &&
    typeof content.assetId === "string"
  ) {
    const asset = await intelligence.ɵgetManagedChannelAsset(content.assetId);
    return {
      ...content,
      source: {
        type: "data",
        value: Buffer.from(asset.bytes).toString("base64"),
        mimeType:
          asset.mimeType ??
          ("mimeType" in content && typeof content.mimeType === "string"
            ? content.mimeType
            : "application/octet-stream"),
      },
    };
  }

  return content;
}
