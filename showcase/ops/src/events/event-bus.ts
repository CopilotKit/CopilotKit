import { EventEmitter } from "node:events";
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

export interface WriterFailedEvent {
  /** Probe/deploy key the writer was processing (e.g. "smoke:mastra"). */
  key: string;
  /** Phase of the write that failed — useful for /health triage. */
  phase: "status_upsert" | "history_create";
  err: string;
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

export function createEventBus(): TypedEventBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);
  return {
    emit(event, payload) {
      emitter.emit(String(event), payload);
    },
    on(event, handler) {
      // Wrap the handler so a throw in one subscriber never prevents later
      // subscribers from running. Node's EventEmitter re-throws listener
      // errors by default and halts further dispatch on that emit.
      const wrapper = (p: unknown) => {
        try {
          handler(p as never);
        } catch (err) {
          logger.error("event-bus: subscriber threw, continuing dispatch", {
            event: String(event),
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      };
      emitter.on(String(event), wrapper);
      return () => emitter.off(String(event), wrapper);
    },
    removeAll() {
      emitter.removeAllListeners();
    },
  };
}
