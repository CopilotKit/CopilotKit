import type {
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
} from "./agent-runner";
import { AgentRunner } from "./agent-runner";
import type { AgentRunnerStopRequest } from "./agent-runner";
import type { Observable } from "rxjs";
import { ReplaySubject } from "rxjs";
import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunStartedEvent,
  StateSnapshotEvent,
} from "@ag-ui/client";
import { EventType, compactEvents } from "@ag-ui/client";
import { finalizeRunEvents } from "@copilotkit/shared";

export interface InMemoryLimits {
  /** LRU cap on distinct threads. */
  maxThreads?: number;
  /** FIFO cap on runs kept per thread. `Infinity` or `0` disables the cap. */
  maxRunsPerThread?: number;
  /**
   * Approximate byte ceiling on RETAINED thread/run history. Enforced at run
   * completion (in `appendRun`), where LRU non-running threads are evicted to
   * keep the total under this limit.
   *
   * Limitation: this bounds only history that has already been committed. A
   * single in-flight run's buffered events (`currentRunEvents` and the two
   * `ReplaySubject<BaseEvent>(Infinity)` buffers in `run()`) are NOT counted
   * until that run completes, so `maxBytes` does not bound a single runaway
   * run mid-stream.
   *
   * Limitation: byte eviction drops only other LRU non-running threads and
   * never self-evicts the active/just-appended thread, so a single dominant
   * thread's own retained history is not byte-trimmed (bounded only by
   * `maxRunsPerThread`). `maxBytes` is thus a cross-thread ceiling enforced by
   * evicting OTHER threads, not a per-thread cap.
   */
  maxBytes?: number;
}

/**
 * Constructor options for {@link InMemoryAgentRunner}.
 *
 * Extends {@link InMemoryLimits} so bounds can be passed inline alongside the
 * per-runner behavior flags. Be aware of the scope difference: the limits
 * reconfigure the process-global store shared by every runner, whereas
 * `onConcurrentRun` applies only to the runner instance it is passed to.
 */
export interface InMemoryAgentRunnerOptions extends InMemoryLimits {
  /**
   * How to handle a `run()` for a thread that already has an in-flight run.
   * `"throw"` (default) rejects with "Thread already running". `"supersede"`
   * aborts the prior run and starts the new one.
   */
  onConcurrentRun?: "throw" | "supersede";
}

export const ɵINMEMORY_DEFAULTS: Required<InMemoryLimits> = {
  maxThreads: 1000,
  maxRunsPerThread: 100,
  maxBytes: 512 * 1024 ** 2,
};

/**
 * A limit value is well-formed iff it is a non-negative integer OR `+Infinity`.
 * `+Infinity` is the documented "disabled/unbounded" sentinel and `0` is the
 * documented run-cap disable sentinel; both are non-negative and pass. Every
 * enforcement site (`evictThreadsIfNeeded`, `enforceRunCap`,
 * `evictByBytesIfNeeded`) compares its counter against the limit with `>` in a
 * `while`/`if` guard, so only these shapes keep those loops finite and correct.
 * Rejected: negatives (drive `count > -1` true on an empty collection, so
 * `enforceRunCap` `shift()!`s `undefined` and throws), `-Infinity` (loops never
 * terminate their intent — always "over"), `NaN` (every `>` is false, silently
 * disabling the bound), and non-integer finites (fractional caps are nonsense).
 */
function ɵisValidLimit(value: number): boolean {
  return value === Infinity || (Number.isInteger(value) && value >= 0);
}

/**
 * Normalize a fully-resolved limits bag so every field is well-formed before it
 * can reach an enforcement loop. Each field is validated independently against
 * {@link ɵisValidLimit}; an invalid value is CLAMPED to its
 * {@link ɵINMEMORY_DEFAULTS} floor and a single `console.warn` naming the field
 * and the received value is emitted.
 *
 * Clamp-and-warn (rather than throw) is deliberate and matches this file's
 * established posture toward bad input: `ɵestimateBytes` swallows serialization
 * failures and returns 0, the limits-clobber path warns rather than throwing,
 * and both the eviction and clobber logs are wrapped so "logging must never
 * break construction/a run". Constructing a bounded in-memory runner is a
 * best-effort, non-durable convenience; a typo'd bound must degrade to a safe
 * default, never abort construction or (worse) surface later as an unhandled
 * rejection from the fire-and-forget finalize path.
 */
export function ɵnormalizeLimits(
  limits: Required<InMemoryLimits>,
): Required<InMemoryLimits> {
  const normalized = { ...limits };
  for (const field of Object.keys(
    ɵINMEMORY_DEFAULTS,
  ) as (keyof InMemoryLimits)[]) {
    const value = limits[field];
    if (!ɵisValidLimit(value)) {
      const fallback = ɵINMEMORY_DEFAULTS[field];
      normalized[field] = fallback;
      try {
        console.warn(
          `[CopilotKit] InMemoryAgentRunner: invalid ${field} value ` +
            `${String(value)} (expected a non-negative integer or Infinity); ` +
            `falling back to ${String(fallback)}.`,
        );
      } catch {
        // best-effort: logging must never break construction
      }
    }
  }
  return normalized;
}

const EVICTION_GUIDANCE =
  "[CopilotKit] InMemoryAgentRunner evicted in-memory thread history to stay " +
  "under memory limits. This runner is bounded and non-durable by design. For " +
  "durable or production threads, configure an Intelligence backend.";

const LIMITS_CLOBBER_GUIDANCE =
  "[CopilotKit] InMemoryAgentRunner was constructed with in-memory limits that " +
  "differ from the already-configured process-global store; the last-constructed " +
  "runner's limits apply to ALL in-memory threads (the store is shared per-process). " +
  "Configure a single consistent set of limits, or use an Intelligence backend for " +
  "isolated bounds.";

/**
 * Best-effort approximate byte size of a value, via serialized length.
 * Never throws — returns 0 when the value cannot be serialized. This is an
 * approximation (UTF-16 length, not exact heap bytes), used only for relative
 * accounting against `maxBytes`.
 */
export function ɵestimateBytes(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Per-run finalize intent, captured once when a run starts and mutated (only)
 * by whoever aborts THAT run — `stop()` or a superseding `run()`. The run's own
 * teardown reads this captured holder instead of the shared, mutable
 * `store.stopRequested`, so a later run that resets store state can never cause
 * an intentionally-stopped run to be finalized as an error (or vice versa).
 */
interface RunFinalizeControl {
  /** True once THIS run has been asked to stop (clean stop, not an error). */
  stopRequested: boolean;
}

interface HistoricRun {
  threadId: string;
  runId: string;
  /** ID of the agent that executed this run. */
  agentId: string;
  parentRunId: string | null;
  events: BaseEvent[];
  /**
   * Snapshot of all messages (input + generated) at the end of this run, as
   * passed in by the caller. NOTE: `BoundedThreadStore.appendRun` moves this
   * snapshot to the THREAD level (`InMemoryEventStore.messagesSnapshot`) and
   * clears this field to `[]`, so a stored HistoricRun never carries messages.
   * The thread-messages fallback reads the thread-level snapshot, not this.
   */
  messages: Message[];
  createdAt: number;
  /** Approximate retained byte size of `events`; set by BoundedThreadStore at append. */
  approxEventBytes?: number;
  /**
   * Legacy field retained for shape compatibility. `appendRun` always zeroes it
   * because message bytes are accounted at the thread level, not per run.
   */
  approxMessageBytes?: number;
}

/**
 * Lightweight thread summary returned by {@link InMemoryAgentRunner.listThreads}.
 * Shape matches the Intelligence platform's ThreadRecord so the same HTTP
 * response envelope can be used for both backends.
 */
export interface InMemoryThread {
  id: string;
  name: string | null;
  agentId: string;
  organizationId: ""; // always empty in in-memory mode
  createdById: ""; // always empty in in-memory mode
  archived: false; // always false in in-memory mode
  createdAt: string;
  updatedAt: string;
}

class InMemoryEventStore {
  constructor(public threadId: string) {}

  /** The subject that current consumers subscribe to. */
  subject: ReplaySubject<BaseEvent> | null = null;

  /** True while a run is actively producing events. */
  isRunning = false;

  /** Current run ID */
  currentRunId: string | null = null;

  /** Historic completed runs */
  historicRuns: HistoricRun[] = [];

  /** Currently running agent instance (if any). */
  agent: AbstractAgent | null = null;

  /** Subject returned from run() while the run is active. */
  runSubject: ReplaySubject<BaseEvent> | null = null;

  /**
   * Thread-level lifecycle flag: true once a stop/supersede has been requested
   * for the currently-owning run but that run has not yet finalized. Drives
   * eviction protection, the connect() bridge, and stop() de-dup. This is NOT
   * the finalize intent read by a run's teardown — that lives per-run on
   * {@link activeFinalize}, so a superseding run resetting this field cannot
   * mislabel the run it replaced. A new run resets this to false when it takes
   * ownership.
   */
  stopRequested = false;

  /**
   * Finalize control of the currently-owning run. `stop()` and a superseding
   * `run()` flip the owning run's flag through this reference; each run also
   * captures the SAME object in its closure, so its teardown finalizes against
   * its own intent regardless of what a later run does to the store.
   */
  activeFinalize: RunFinalizeControl | null = null;

  /** Reference to the events emitted in the current run. */
  currentEvents: BaseEvent[] | null = null;

  /**
   * The thread's single latest NON-EMPTY message snapshot, held at the THREAD
   * level (independent of `historicRuns` lifecycle). Decoupling the snapshot
   * from per-run storage means run-cap FIFO eviction and interleaved
   * empty-snapshot runs can never drop or pin the thread's message history.
   */
  messagesSnapshot: Message[] = [];

  /** Approximate retained byte size of `messagesSnapshot`. */
  approxMessagesSnapshotBytes = 0;

  /**
   * The thread's true creation timestamp (epoch ms), captured from the FIRST
   * run ever appended and held at the THREAD level (independent of
   * `historicRuns` lifecycle). Decoupling it from per-run storage means run-cap
   * FIFO eviction — which shifts the oldest entries off `historicRuns` — can
   * never move the reported creation time forward. `null` until the first run
   * lands. Mirrors the `messagesSnapshot` thread-level decoupling.
   */
  createdAt: number | null = null;
}

export class ɵBoundedThreadStore {
  private readonly map = new Map<string, InMemoryEventStore>();
  private totalBytes = 0;
  private warned = false;
  /** True once limits have been EXPLICITLY set (via setLimits), not just the constructor default. */
  private limitsExplicitlySet = false;
  /** Warn-once latch for the clobber warning, kept distinct from the eviction `warned` latch. */
  private clobberWarned = false;

  private limits: Required<InMemoryLimits>;

  constructor(limits: Required<InMemoryLimits>) {
    // Normalize once at construction so `this.limits` is ALWAYS well-formed,
    // regardless of entry point (direct construction or a later `setLimits`).
    this.limits = ɵnormalizeLimits(limits);
  }

  get byteTotal(): number {
    return this.totalBytes;
  }

  /**
   * The store's CURRENT effective bounds. Exposed (with the `ɵ` internal-API
   * prefix) so a partial `setLimits` can coalesce unspecified fields against the
   * live config rather than the hardcoded {@link ɵINMEMORY_DEFAULTS} — a partial
   * update must be a partial update, never a silent reset of the fields the
   * caller did not mention. Returns a copy so callers cannot mutate the store's
   * bounds through it.
   */
  get ɵlimits(): Required<InMemoryLimits> {
    return { ...this.limits };
  }

  /**
   * Reconfigure the process-global store's bounds. Called by the
   * {@link InMemoryAgentRunner} constructor when limits are passed. Because the
   * store is a per-process singleton, this replaces the bounds for ALL in-memory
   * threads. Emits {@link LIMITS_CLOBBER_GUIDANCE} at most ONCE per store when a
   * SECOND (or later) explicit set arrives whose resolved values differ from the
   * prior explicit set — i.e. a genuine clobber of an already-customized config.
   * The first explicit customization (defaults → custom) is the intended
   * override and never warns; identical re-sets never warn.
   */
  setLimits(limits: Required<InMemoryLimits>): void {
    // Normalize FIRST so invalid fields can never reach an enforcement loop and
    // so the clobber comparison below is against the EFFECTIVE (clamped) values,
    // not the raw ones — a typo'd bound that clamps to the current default is not
    // a genuine clobber and must not warn.
    const normalized = ɵnormalizeLimits(limits);
    if (
      this.limitsExplicitlySet &&
      !this.clobberWarned &&
      (normalized.maxThreads !== this.limits.maxThreads ||
        normalized.maxRunsPerThread !== this.limits.maxRunsPerThread ||
        normalized.maxBytes !== this.limits.maxBytes)
    ) {
      this.clobberWarned = true;
      try {
        console.warn(LIMITS_CLOBBER_GUIDANCE);
      } catch {
        // best-effort: logging must never break construction
      }
    }
    this.limitsExplicitlySet = true;
    this.limits = normalized;
  }

  get size(): number {
    return this.map.size;
  }

  /** Re-insert at the tail so Map iteration order stays LRU-first. */
  private touchOrder(threadId: string, store: InMemoryEventStore): void {
    this.map.delete(threadId);
    this.map.set(threadId, store);
  }

  getOrCreate(threadId: string): InMemoryEventStore {
    const existing = this.map.get(threadId);
    if (existing) {
      this.touchOrder(threadId, existing);
      return existing;
    }
    const store = new InMemoryEventStore(threadId);
    this.map.set(threadId, store);
    this.evictThreadsIfNeeded(threadId);
    return store;
  }

  get(
    threadId: string,
    opts: { touch: boolean },
  ): InMemoryEventStore | undefined {
    const store = this.map.get(threadId);
    if (store && opts.touch) this.touchOrder(threadId, store);
    return store;
  }

  peek(threadId: string): InMemoryEventStore | undefined {
    return this.map.get(threadId);
  }

  /**
   * Evict the least-recently-used thread that is neither running NOR
   * mid-finalization. Returns false if none evictable. The `protect` thread
   * (typically the one just created) is never evicted, so a fresh thread is not
   * immediately dropped when it is the only non-running candidate.
   *
   * A thread is skipped while `isRunning` OR `stopRequested` is set.
   * `stop()` flips `isRunning` to false the moment it aborts the agent, but the
   * run keeps finalizing asynchronously (the abort trips the `catch` in
   * `runAgent`, which later calls `appendRun`). During that window
   * `stopRequested` stays true; evicting the thread then would make the pending
   * `appendRun` hit `if (!store) return` and silently drop the aborted run's
   * history. Guarding on `stopRequested` keeps the thread alive until
   * finalization completes.
   */
  private evictOneLru(protect?: string): boolean {
    for (const [threadId, store] of this.map) {
      if (threadId === protect) continue; // never evict the just-created thread
      // never evict a running or still-finalizing (stop-requested) thread
      if (store.isRunning || store.stopRequested) continue;
      this.removeThread(threadId, store);
      this.noteEviction();
      return true;
    }
    return false;
  }

  appendRun(threadId: string, run: HistoricRun): void {
    const store = this.map.get(threadId);
    if (!store) return; // best-effort: nothing to append to

    // Thread-level creation timestamp: capture the FIRST run's createdAt once
    // and never overwrite it. Held on the store (not derived from
    // `historicRuns[0]`) so run-cap FIFO eviction of the oldest runs cannot
    // drift the thread's reported creation time forward. Mirrors the
    // thread-level `messagesSnapshot` decoupling below.
    if (store.createdAt === null) {
      store.createdAt = run.createdAt;
    }

    // Thread-level message snapshot: keep the single latest NON-EMPTY snapshot
    // on the store, decoupled from `historicRuns`. When the incoming run
    // carries a non-empty snapshot, replace the thread's snapshot (adjusting
    // byte accounting). When it's empty (non-array `agent.messages` or an
    // error-path run), leave the existing thread snapshot untouched so history
    // is never lost. The snapshot never lives on a HistoricRun, so run-cap FIFO
    // eviction can never drop it and an interleaved empty run can never pin it.
    if (run.messages.length > 0) {
      this.totalBytes -= store.approxMessagesSnapshotBytes;
      // Store the incoming array directly (SHALLOW, array-level copy). `run.messages`
      // is already a fresh `[...agent.messages]` array created in run(), so we own the
      // array and it is decoupled from `agent.messages` at the array level (push/splice
      // on the agent's array cannot mutate our snapshot). We deliberately do NOT deep-copy
      // here: `structuredClone` throws DataCloneError on a non-cloneable message field,
      // which would wedge the thread and hang SSE — inconsistent with `ɵestimateBytes`,
      // which tolerates the same bad-payload class. The tradeoff is that the inner
      // `Message` objects remain shared by reference with `agent.messages`, so an agent
      // that mutates its own message objects IN PLACE after the run can still be observed
      // through this snapshot. That inner-object isolation is a known limitation tracked as
      // follow-up; callers must treat returned messages as read-only. Estimate bytes on the
      // same value so accounting matches exactly what is retained.
      store.messagesSnapshot = run.messages;
      store.approxMessagesSnapshotBytes = ɵestimateBytes(run.messages);
      this.totalBytes += store.approxMessagesSnapshotBytes;
    }

    // Do not carry message bytes on the HistoricRun: the snapshot is now tracked
    // at the thread level, so historicRuns must never account message bytes.
    run.messages = [];
    run.approxMessageBytes = 0;

    // Compute this run's approximate event size once, at append time.
    run.approxEventBytes = ɵestimateBytes(run.events);
    store.historicRuns.push(run);
    this.totalBytes += run.approxEventBytes;
    this.touchOrder(threadId, store);

    this.enforceRunCap(store);
    this.evictByBytesIfNeeded(threadId);
  }

  private enforceRunCap(store: InMemoryEventStore): void {
    const cap = this.limits.maxRunsPerThread;
    if (!cap || cap === Infinity) return; // 0 or Infinity → disabled
    while (store.historicRuns.length > cap) {
      const dropped = store.historicRuns.shift()!;
      // Only event bytes live on a HistoricRun; the message snapshot is tracked
      // at the thread level and survives run-cap eviction.
      this.totalBytes -= dropped.approxEventBytes ?? 0;
      // Per-thread run-cap trimming is also eviction — history is being dropped.
      // Route it through the SAME warn-once latch as whole-thread LRU eviction so
      // this shows up in logs rather than as silent data loss. `noteEviction` is
      // latched (one warning per store, reset by `clear()`), so a hot thread that
      // trims on every subsequent append warns once, never per dropped run. The
      // loop only runs when a run is ACTUALLY over the cap, so a disabled or
      // under-cap `enforceRunCap` stays silent (it returned / never entered here).
      this.noteEviction();
    }
  }

  /**
   * Trim the store back under the byte ceiling by evicting LRU non-running
   * threads. `protect` (the just-appended thread) is never self-evicted, so a
   * fresh run pushes OTHER threads out rather than dropping itself.
   */
  private evictByBytesIfNeeded(protect?: string): void {
    while (this.totalBytes > this.limits.maxBytes) {
      if (!this.evictOneLru(protect)) break; // only protected/running threads left → accept overage
    }
  }

  private removeThread(threadId: string, store: InMemoryEventStore): void {
    for (const run of store.historicRuns) {
      this.totalBytes -= run.approxEventBytes ?? 0;
    }
    // The thread's message snapshot is tracked at the store level, so it must
    // be reclaimed here in addition to the per-run event bytes.
    this.totalBytes -= store.approxMessagesSnapshotBytes;
    this.map.delete(threadId);
  }

  private evictThreadsIfNeeded(protect?: string): void {
    while (this.map.size > this.limits.maxThreads) {
      if (!this.evictOneLru(protect)) break; // everything evictable is running → accept overage
    }
  }

  private noteEviction(): void {
    if (this.warned) return;
    this.warned = true;
    try {
      console.warn(EVICTION_GUIDANCE);
    } catch {
      // best-effort: logging must never break a run
    }
  }

  listThreads(): InMemoryThread[] {
    const threads: InMemoryThread[] = [];
    for (const [threadId, store] of this.map) {
      if (store.historicRuns.length === 0) continue;
      const lastRun = store.historicRuns[store.historicRuns.length - 1]!;
      // Creation time comes from the thread-level `store.createdAt` (the first
      // run ever appended), NOT `historicRuns[0]` (the oldest RETAINED run):
      // run-cap FIFO eviction drops the oldest retained runs, so deriving it
      // from `historicRuns[0]` would silently drift the timestamp forward over
      // a thread's lifetime. `updatedAt` stays on `lastRun` because FIFO
      // eviction removes from the FRONT, so the newest run is never evicted.
      // The `?? lastRun.createdAt` fallback is defensive only: any thread with
      // runs has had `store.createdAt` set by `appendRun`.
      threads.push({
        id: threadId,
        name: null,
        agentId: lastRun.agentId,
        organizationId: "",
        createdById: "",
        archived: false,
        createdAt: new Date(store.createdAt ?? lastRun.createdAt).toISOString(),
        updatedAt: new Date(lastRun.createdAt).toISOString(),
      });
    }
    return threads.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  clear(): void {
    this.map.clear();
    this.totalBytes = 0;
    this.warned = false;
  }
}

/**
 * Process-wide singleton backing every {@link InMemoryAgentRunner}. Exported
 * (with the `ɵ` internal-API prefix) so tests can inspect the exact store the
 * runner writes to; not part of the public API.
 */
export const ɵGLOBAL_STORE = new ɵBoundedThreadStore(ɵINMEMORY_DEFAULTS);
const sharedStore = ɵGLOBAL_STORE;

export class InMemoryAgentRunner extends AgentRunner {
  readonly ɵsupportsLocalThreadEndpoints = true;

  /**
   * How to handle a `run()` for a thread that already has an in-flight run.
   * `"throw"` (default) preserves the historic behavior. `"supersede"` aborts
   * the prior run (mirroring `stop()`) and starts the new one — opted into by
   * the hosted-bot listener so a fast follow-up turn on the same thread cleanly
   * replaces a still-running (or wedged) prior turn instead of erroring with
   * "Thread already running".
   */
  private readonly onConcurrentRun: "throw" | "supersede";

  /**
   * @param options Per-runner behavior (`onConcurrentRun`) plus optional bounds
   * for the in-memory store ({@link InMemoryLimits}).
   *
   * Note the differing scopes: `onConcurrentRun` is per-runner instance, while
   * the limits reconfigure the PROCESS-GLOBAL store shared by every
   * `InMemoryAgentRunner`. Omit the limits for safe defaults
   * ({@link ɵINMEMORY_DEFAULTS}); passing none leaves the store untouched. When
   * multiple runners are constructed with differing limits, the last-constructed
   * wins — in practice the OSS/SSE default construction passes nothing. If a
   * second (or later) runner is constructed with limits that DIFFER from an
   * already-customized store, a one-time `console.warn` is emitted to signal that
   * the shared store's bounds are being clobbered for ALL in-memory threads.
   */
  constructor(options?: InMemoryAgentRunnerOptions) {
    super();
    const { onConcurrentRun, ...limits } = options ?? {};
    this.onConcurrentRun = onConcurrentRun ?? "throw";

    // Only reconfigure the shared store when a bound was actually supplied.
    // `new InMemoryAgentRunner({ onConcurrentRun: "supersede" })` must stay
    // inert with respect to limits.
    if (
      limits.maxThreads !== undefined ||
      limits.maxRunsPerThread !== undefined ||
      limits.maxBytes !== undefined
    ) {
      // Coalesce each unspecified field against the store's CURRENT effective
      // limits, NOT ɵINMEMORY_DEFAULTS. The store is process-global, so tuning
      // one bound must leave every previously-customized sibling bound intact —
      // a partial update stays a partial update instead of silently resetting the
      // fields the caller never mentioned. Passing all three (e.g.
      // ɵINMEMORY_DEFAULTS) still fully replaces the config, so the defaults-
      // restore path is unaffected.
      const current = sharedStore.ɵlimits;
      sharedStore.setLimits({
        maxThreads: limits.maxThreads ?? current.maxThreads,
        maxRunsPerThread: limits.maxRunsPerThread ?? current.maxRunsPerThread,
        maxBytes: limits.maxBytes ?? current.maxBytes,
      });
    }
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    const store = sharedStore.getOrCreate(request.threadId);

    // Enter the concurrency branch whenever a prior run still owns the thread —
    // either actively running OR still finalizing after a stop()/supersede.
    // `stop()` flips `isRunning` to false the instant it aborts the agent, but
    // the run keeps finalizing asynchronously (`stopRequested` stays true).
    // Gating on `isRunning` alone let a `run()` slip through that window
    // unhandled: no supersede/throw, no per-run intent capture, and a leaked
    // bridge from the dying run's subject.
    if (store.isRunning || store.stopRequested) {
      if (this.onConcurrentRun !== "supersede") {
        throw new Error("Thread already running");
      }
      // Supersede: abort the prior (possibly wedged) run so this one can start.
      // Mirrors stop(). Record the prior run's OWN finalize intent on its
      // captured control BEFORE resetting the shared store flags for the new
      // run: a supersede is a clean stop of the prior run, so its async teardown
      // must finalize as RUN_FINISHED, never a synthetic RUN_ERROR. The prior
      // run's async finalization is prevented from clobbering this run's state
      // by the run-id guard below.
      const priorAgent = store.agent;
      const priorFinalize = store.activeFinalize;
      if (priorFinalize) {
        priorFinalize.stopRequested = true;
      }
      store.isRunning = false;
      if (priorAgent) {
        try {
          priorAgent.abortRun();
        } catch (error) {
          console.error("Failed to abort superseded run", error);
        }
      }
    }
    store.isRunning = true;
    store.currentRunId = request.input.runId;
    store.agent = request.agent;
    store.stopRequested = false;

    // Per-run finalize control. This run's teardown reads THIS captured holder
    // (never the shared `store.stopRequested`, which a later run resets), so an
    // aborted run is always finalized against its own stop-intent.
    const finalizeControl: RunFinalizeControl = { stopRequested: false };
    store.activeFinalize = finalizeControl;

    // Track seen message IDs and current run events for this run
    const seenMessageIds = new Set<string>();
    const currentRunEvents: BaseEvent[] = [];
    store.currentEvents = currentRunEvents;

    // Get all previously seen message IDs from historic runs
    const historicMessageIds = new Set<string>();
    for (const run of store.historicRuns) {
      for (const event of run.events) {
        if ("messageId" in event && typeof event.messageId === "string") {
          historicMessageIds.add(event.messageId);
        }
        if (event.type === EventType.RUN_STARTED) {
          const runStarted = event as RunStartedEvent;
          const messages = runStarted.input?.messages ?? [];
          for (const message of messages) {
            historicMessageIds.add(message.id);
          }
        }
      }
    }

    const nextSubject = new ReplaySubject<BaseEvent>(Infinity);

    // Update the store's subject immediately. We intentionally do NOT capture
    // and bridge the previous subject: see the note before `runAgent()` below.
    store.subject = nextSubject;

    // Create a subject for run() return value
    const runSubject = new ReplaySubject<BaseEvent>(Infinity);
    store.runSubject = runSubject;

    // Helper function to run the agent and handle errors
    const runAgent = async () => {
      // Get parent run ID for chaining
      const lastRun = store.historicRuns[store.historicRuns.length - 1];
      const parentRunId = lastRun?.runId ?? null;

      // Shared teardown for both the success and error paths. Keeping this one
      // helper means the two paths cannot drift apart (they were near-identical
      // and must stay symmetric). `interruptionMessage` is set only on the error
      // path; its presence is what distinguishes the two.
      const finalizeRun = (opts: { interruptionMessage?: string }) => {
        const isError = opts.interruptionMessage !== undefined;

        // Capture the count of REAL (agent-emitted) events BEFORE finalizing.
        // `finalizeRunEvents` mutates `currentRunEvents` IN PLACE — it always
        // pushes a synthetic terminal (and any closers) when the stream ended
        // without one — so after the call `currentRunEvents.length` is never 0.
        // The persistence guard below must gate on this pre-finalize count, or
        // the "skip an immediate throw that emitted nothing" check is dead.
        const preFinalizeEventCount = currentRunEvents.length;

        // Finalize against THIS run's own captured stop-intent — never the
        // shared `store.stopRequested`, which a superseding run resets. An
        // aborted run is thus finalized as a clean RUN_FINISHED, not a synthetic
        // RUN_ERROR.
        const appendedEvents = finalizeRunEvents(currentRunEvents, {
          stopRequested: finalizeControl.stopRequested,
          ...(isError ? { interruptionMessage: opts.interruptionMessage } : {}),
        });
        for (const event of appendedEvents) {
          runSubject.next(event);
          nextSubject.next(event);
        }

        // Does this run still own the thread? A superseding run has changed
        // `currentRunId`, so the run it replaced no longer owns the store.
        const ownsThread = store.currentRunId === request.input.runId;

        // Store this run's events. Guard on the per-run id (not the shared
        // `store.currentRunId`): a superseded run no longer owns the store, so
        // it must not push history — and never under a newer run's id, which
        // would corrupt the thread's history. On the error path also require at
        // least one real (pre-finalize) event, so an immediate throw with
        // nothing emitted does not create a phantom historic run holding only
        // the synthetic terminal.
        if (ownsThread && (!isError || preFinalizeEventCount > 0)) {
          // Compact the events before storing (like SQLite does)
          const compactedEvents = compactEvents(currentRunEvents);
          sharedStore.appendRun(request.threadId, {
            threadId: request.threadId,
            runId: request.input.runId,
            agentId: request.agent.agentId ?? "default",
            parentRunId,
            events: compactedEvents,
            // Snapshot all messages (input + generated) for the thread-messages endpoint
            messages: Array.isArray(request.agent.messages)
              ? [...request.agent.messages]
              : [],
            createdAt: Date.now(),
          });
        }

        // Complete the run. Guard the shared-store reset: if a newer run has
        // superseded this one (`currentRunId` changed), that run now owns the
        // store — don't clobber its state. Always complete THIS run's subjects.
        if (ownsThread) {
          store.currentEvents = null;
          store.currentRunId = null;
          store.agent = null;
          store.runSubject = null;
          store.stopRequested = false;
          store.isRunning = false;
          store.activeFinalize = null;
        }
        runSubject.complete();
        nextSubject.complete();
        // Time-scoped release: this run's events are now in historicRuns, so its
        // infinite ReplaySubject buffer is pure duplication — drop the store's
        // reference so it becomes collectable. The identity guard is what makes
        // this correct, and it does so differently on each path:
        //
        //   - Owning path: no newer run superseded this one, so store.subject is
        //     still nextSubject and the guard passes. The `if (ownsThread)` block
        //     above just cleared isRunning and stopRequested, so connect() — which
        //     bridges store.subject only while isRunning || stopRequested — will
        //     not re-subscribe; it rebuilds this run's events from historicRuns
        //     instead. Nulling the reference is therefore safe.
        //
        //   - Superseded path (`onConcurrentRun: "supersede"`): a newer run has
        //     already installed ITS subject and run id on the store, so the guard
        //     fails and we leave store.subject untouched. Here isRunning/
        //     stopRequested describe that live run (isRunning is typically true),
        //     so it is precisely the identity guard — not those flags — that
        //     prevents us from nulling the live run's subject and cutting
        //     connect() off from the in-flight stream. This run's own buffer is no
        //     longer referenced by the store and becomes collectable regardless.
        if (store.subject === nextSubject) {
          store.subject = null;
        }
      };

      try {
        await request.agent.runAgent(request.input, {
          onEvent: ({ event }) => {
            let processedEvent: BaseEvent = event;
            if (event.type === EventType.RUN_STARTED) {
              const runStartedEvent = event as RunStartedEvent;
              if (!runStartedEvent.input) {
                const sanitizedMessages = request.input.messages
                  ? request.input.messages.filter(
                      (message) => !historicMessageIds.has(message.id),
                    )
                  : undefined;
                const updatedInput = {
                  ...request.input,
                  ...(sanitizedMessages !== undefined
                    ? { messages: sanitizedMessages }
                    : {}),
                };
                runStartedEvent.input = updatedInput;
                processedEvent = runStartedEvent;
              }
            }

            runSubject.next(processedEvent); // For run() return - only agent events
            nextSubject.next(processedEvent); // For connect() / store - all events
            currentRunEvents.push(processedEvent); // Accumulate for storage
          },
          onNewMessage: ({ message }) => {
            // Called for each new message
            if (!seenMessageIds.has(message.id)) {
              seenMessageIds.add(message.id);
            }
          },
          onRunStartedEvent: () => {
            // Mark any messages from the input as seen so they aren't emitted twice
            if (request.input.messages) {
              for (const message of request.input.messages) {
                if (!seenMessageIds.has(message.id)) {
                  seenMessageIds.add(message.id);
                }
              }
            }
          },
        });

        finalizeRun({});
      } catch (error) {
        const interruptionMessage =
          error instanceof Error ? error.message : String(error);
        finalizeRun({ interruptionMessage });
      }
    };

    // NOTE: we deliberately do NOT bridge the previous store subject into
    // `nextSubject`. `store.subject` is nulled the moment a run fully tears down
    // (identity guard in `finalizeRun`), so the previous subject is non-null
    // ONLY when this run is superseding a prior run that is still in flight or
    // finalizing. Forwarding that dying run's subject would replay its buffered
    // RUN_STARTED and push its terminal event (RUN_FINISHED/RUN_ERROR) into THIS
    // live run's stream — an invalid AG-UI sequence on a healthy run. A
    // superseded run's stream must stay isolated: it reaches only its own
    // connect() subscribers via its own (now-detached) subject, never the
    // superseding run's.

    // Start the agent execution immediately (not lazily)
    runAgent();

    // Return the run subject (only agent events, no injected messages)
    return runSubject.asObservable();
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const store = sharedStore.get(request.threadId, { touch: true });
    const connectionSubject = new ReplaySubject<BaseEvent>(Infinity);

    if (!store) {
      // No store means no events
      connectionSubject.complete();
      return connectionSubject.asObservable();
    }

    // Collect all historic events from memory
    const allHistoricEvents: BaseEvent[] = [];
    for (const run of store.historicRuns) {
      allHistoricEvents.push(...run.events);
    }

    // Apply compaction to all historic events together (like SQLite)
    const compactedEvents = compactEvents(allHistoricEvents);

    // Emit compacted events and track message IDs
    const emittedMessageIds = new Set<string>();
    for (const event of compactedEvents) {
      connectionSubject.next(event);
      if ("messageId" in event && typeof event.messageId === "string") {
        emittedMessageIds.add(event.messageId);
      }
    }

    // Bridge active run to connection if exists
    if (store.subject && (store.isRunning || store.stopRequested)) {
      store.subject.subscribe({
        next: (event) => {
          // Skip message events that we've already emitted from historic
          if (
            "messageId" in event &&
            typeof event.messageId === "string" &&
            emittedMessageIds.has(event.messageId)
          ) {
            return;
          }
          connectionSubject.next(event);
        },
        complete: () => connectionSubject.complete(),
        error: (err) => connectionSubject.error(err),
      });
    } else {
      // No active run, complete after historic events
      connectionSubject.complete();
    }

    return connectionSubject.asObservable();
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    const store = sharedStore.peek(request.threadId);
    return Promise.resolve(store?.isRunning ?? false);
  }

  stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const store = sharedStore.peek(request.threadId);
    if (!store || !store.isRunning) {
      return Promise.resolve(false);
    }
    if (request.runId !== undefined && store.currentRunId !== request.runId) {
      return Promise.resolve(false);
    }
    if (store.stopRequested) {
      return Promise.resolve(false);
    }

    store.stopRequested = true;
    store.isRunning = false;
    // Record the stop on the running run's OWN finalize control so its async
    // teardown finalizes as a clean RUN_FINISHED. This is the same object that
    // run's closure reads, so a later run cannot mislabel this stop.
    const finalizeControl = store.activeFinalize;
    if (finalizeControl) {
      finalizeControl.stopRequested = true;
    }

    const agent = store.agent;
    if (!agent) {
      store.stopRequested = false;
      store.isRunning = false;
      if (finalizeControl) {
        finalizeControl.stopRequested = false;
      }
      return Promise.resolve(false);
    }

    try {
      agent.abortRun();
      return Promise.resolve(true);
    } catch (error) {
      console.error("Failed to abort agent run", error);
      store.stopRequested = false;
      store.isRunning = true;
      if (finalizeControl) {
        finalizeControl.stopRequested = false;
      }
      return Promise.resolve(false);
    }
  }

  /**
   * Returns a summary of every thread that has been run through this runner.
   *
   * This powers the local-dev fallback for `GET /threads` when the Intelligence
   * platform is not configured. Each entry mirrors the shape of a platform
   * `ThreadRecord` so the HTTP handler can use the same response envelope.
   */
  listThreads(): InMemoryThread[] {
    return sharedStore.listThreads();
  }

  /**
   * Returns all messages for a thread, using the snapshot captured at the end
   * of the most recent run.
   *
   * This powers the local-dev fallback for `GET /threads/:threadId/messages`
   * when the Intelligence platform is not configured. The returned `Message[]`
   * objects come directly from the ag-ui agent, so their shape is compatible
   * with the Intelligence platform's `ThreadMessage` type.
   */
  getThreadMessages(threadId: string): Message[] {
    const store = sharedStore.peek(threadId);
    if (!store) return [];
    // The thread's latest non-empty snapshot is held at the store level,
    // independent of `historicRuns` lifecycle, so run-cap eviction and
    // interleaved empty-snapshot runs can never lose it. Return a SHALLOW
    // (array-level) copy: a fresh array so a caller mutating array STRUCTURE
    // (push/splice/reassign elements) cannot affect the stored snapshot. We
    // deliberately do NOT deep-copy: `structuredClone` throws DataCloneError on a
    // non-cloneable message field, which would wedge the thread and hang SSE —
    // inconsistent with `ɵestimateBytes`, which tolerates the same bad-payload class.
    // The tradeoff is that the inner `Message` objects remain shared by reference with
    // the stored snapshot, so mutating a returned message's FIELD
    // (e.g. `getThreadMessages(t)[0].content = "x"`) is NOT isolated and would corrupt
    // the stored snapshot. That inner-object isolation is a known limitation tracked as
    // follow-up; callers must treat returned messages as read-only.
    return [...store.messagesSnapshot];
  }

  /**
   * Returns all AG-UI events for a thread, compacted across historic runs.
   *
   * Powers the local-dev fallback for `GET /threads/:threadId/events` when the
   * Intelligence platform is not configured. The compaction logic matches
   * the connection-replay path in {@link connect}, so the stream a
   * late-joining inspector sees matches what this method returns.
   */
  getThreadEvents(threadId: string): BaseEvent[] {
    const store = sharedStore.peek(threadId);
    if (!store || store.historicRuns.length === 0) return [];
    const all: BaseEvent[] = [];
    for (const run of store.historicRuns) all.push(...run.events);
    return compactEvents(all);
  }

  /**
   * Returns the agent state snapshot for a thread.
   *
   * Derived from the last `STATE_SNAPSHOT` in the compacted event stream. The
   * AG-UI `compactEvents` helper consolidates STATE_DELTA events and produces
   * a single trailing STATE_SNAPSHOT when state changes exist, so this is a
   * faithful view of state at the end of the most recent run.
   *
   * Returns `null` when the thread has never emitted a STATE_SNAPSHOT.
   */
  getThreadState(threadId: string): Record<string, unknown> | null {
    const events = this.getThreadEvents(threadId);
    // Walk backwards — the last snapshot wins.
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]!;
      if (event.type === EventType.STATE_SNAPSHOT) {
        const snapshot = (event as StateSnapshotEvent).snapshot;
        // Only plain objects satisfy the Record<string, unknown> contract.
        // `typeof [] === "object"` is true, so arrays must be rejected
        // explicitly to avoid returning an array typed as a Record.
        if (
          snapshot &&
          typeof snapshot === "object" &&
          !Array.isArray(snapshot)
        ) {
          // Return a defensive shallow copy so callers can't mutate the
          // snapshot object held inside the stored event (matches the
          // getThreadMessages defensive-copy approach).
          return { ...(snapshot as Record<string, unknown>) };
        }
        return null;
      }
    }
    return null;
  }

  /**
   * Clears all in-memory thread history.
   *
   * Powers the local-dev fallback for `POST /threads/clear`, letting consumers
   * (e.g. the demo's Clear button) reset to an empty thread list without
   * restarting the runtime. Intentionally not exposed on the Intelligence
   * platform path: there, thread history lives in a real database and must
   * not be wiped this way.
   */
  clearThreads(): void {
    sharedStore.clear();
  }
}
