import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import type { ProbeResult, WriteOutcome } from "../types/index.js";
import { logger } from "../logger.js";

export interface DeployResultEvent {
  runId: string;
  runUrl?: string;
  services: string[];
  failed: string[];
  succeeded: string[];
  cancelled: boolean;
  /**
   * True when the showcase deploy workflow reached the report job but the
   * build matrix never ran (e.g. the lockfile gate failed). Senders use this
   * to disambiguate a gated-skip from an all-services failure. Optional so
   * older senders that pre-date the field still decode cleanly.
   */
  gateSkipped?: boolean;
}

/**
 * Classification of a writer failure's underlying cause. Lets the alert
 * engine route transient errors (auth blip, rate limit) separately from
 * structural errors (schema mismatch, bad credentials) — the former is
 * noise, the latter is an actionable ops signal.
 *
 * - `pb_auth_error`    — 401/403 from PocketBase; creds bad or token revoked.
 * - `pb_schema_error`  — 400 validation / missing column; schema drift.
 * - `pb_permission`    — 403 rule-level reject that isn't auth.
 * - `pb_rate_limited`  — 429 after exhausting retries; transient.
 * - `pb_server_error`  — 5xx; transient unless sustained.
 * - `network_error`    — fetch threw (ECONN, AbortError, DNS).
 * - `unknown`          — couldn't classify.
 */
export type WriterFailureReason =
  | "pb_auth_error"
  | "pb_schema_error"
  | "pb_permission"
  | "pb_rate_limited"
  | "pb_server_error"
  | "network_error"
  | "unknown";

export interface WriterFailedEvent {
  /** Probe/deploy key the writer was processing (e.g. "smoke:mastra"). */
  key: string;
  /** Phase of the write that failed — useful for /health triage. */
  phase: "status_upsert" | "history_create";
  /**
   * Serialized error context. Uses a structured representation (message +
   * status + validation payload) rather than bare `String(err)` so PB's
   * `{ data: { field: { code, message } } }` shapes stay legible after
   * emission. See status-writer.errorInfo() for the extraction logic.
   */
  err: string;
  /**
   * Classification of the failure's underlying cause. Alert routing can
   * distinguish transient-vs-structural failures without string-matching
   * the err field. Optional (undefined before B6 landed / producers that
   * don't classify).
   */
  reason?: WriterFailureReason;
  /** HTTP status if the failure was a PB response-code error. */
  status?: number;
  observedAt: string;
}

/**
 * Payload for `rules.reload.failed` — produced by rule-loader.watch when
 * one or more files fail to parse or compile during a hot-reload. Declared
 * here so subscribers are type-safe; rule-loader itself only holds a
 * structural `RuleLoadErrorEmitter` interface to avoid coupling to the bus.
 */
export interface RulesReloadFailedEvent {
  errors: { file: string; error: string }[];
}

export interface BusEvents {
  "status.changed": { outcome: WriteOutcome; result: ProbeResult<unknown> };
  "deploy.result": DeployResultEvent;
  "rule.scheduled": {
    ruleId: string;
    scheduledAt: string;
    result?: ProbeResult<unknown>;
  };
  "rules.reloaded": { count: number };
  /** Emitted when a hot-reload fails to parse/compile one or more rule files. */
  "rules.reload.failed": RulesReloadFailedEvent;
  /**
   * Emitted when status-writer fails mid-flight (PB upsert or history
   * create throws). Orchestrator listens to surface degraded state on
   * /health. Listener side owned by F1 agent.
   */
  "writer.failed": WriterFailedEvent;
  /**
   * Emitted when the S3 backup job fails. Produced by s3-backup.ts via
   * its `onFailure` injection when the orchestrator wires it to this
   * bus. The alert engine can fire a rule off this event so backup
   * failures are first-class signals rather than silent log entries.
   */
  "internal.backup.failed": { err: string };
}

export interface TypedEventBus {
  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void;
  /**
   * Subscribe to `event`. The returned function unsubscribes this exact
   * handler. There is no separate `off(event, handler)` method — handlers
   * are stored as wrapper closures internally (for error isolation) so the
   * handler reference the caller holds is not the one Node's EventEmitter
   * knows about. Using the returned unsubscribe closure guarantees the
   * correct wrapper is removed.
   */
  on<K extends keyof BusEvents>(
    event: K,
    handler: (payload: BusEvents[K]) => void,
  ): () => void;
  removeAll(): void;
}

// MAX_LISTENERS bumped higher than the default 10 to absorb hot-reload churn
// (rule-loader watch() reattaches on every file change; under a rapid edit
// loop we can briefly exceed a lower cap). If this ever fires a
// MaxListenersExceededWarning in prod, check for leaked subscriptions from
// repeated boot/stop cycles before bumping further.
const MAX_LISTENERS = 200;

export function createEventBus(): TypedEventBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(MAX_LISTENERS);
  // Per-subscriber failure counters, keyed by `${event}|${subscriberId}`, so
  // a constantly-failing handler becomes visible at error level (and, once
  // the metrics cluster wires a counter, a Prometheus series). Using a
  // short random id keeps the key stable for the lifetime of a subscription
  // without imposing a caller-supplied id contract.
  return {
    emit(event, payload) {
      emitter.emit(String(event), payload);
    },
    on(event, handler) {
      // Wrap the handler so a throw in one subscriber never prevents later
      // subscribers from running. Node's EventEmitter re-throws listener
      // errors by default and halts further dispatch on that emit.
      const subscriberId = crypto.randomBytes(4).toString("hex");
      let failureCount = 0;
      const wrapper = (p: unknown) => {
        try {
          handler(p as never);
        } catch (err) {
          failureCount += 1;
          // errorId lets operators cross-reference the log line with the
          // subscriber metric (once wired) and any downstream capture.
          const errorId = crypto.randomBytes(6).toString("hex");
          logger.error("event-bus: subscriber threw, continuing dispatch", {
            event: String(event),
            subscriberId,
            errorId,
            failureCount,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      };
      emitter.on(String(event), wrapper);
      return () => emitter.off(String(event), wrapper);
    },
    removeAll() {
      // Also warn if removeAll is called while callers still hold unsubs:
      // those unsubs become no-ops (the wrappers they'd have detached are
      // already gone), but the caller may expect their handler to still
      // be reachable. Surfacing this prevents subtle "why isn't my
      // subscription firing" debugging trips. Kept at debug level — this
      // is intentional behavior on shutdown, just worth noting.
      const count = emitter.eventNames().reduce(
        (n, name) => n + emitter.listenerCount(name),
        0,
      );
      if (count > 0) {
        logger.debug("event-bus: removeAll detaching active listeners", {
          count,
        });
      }
      emitter.removeAllListeners();
    },
  };
}
