export type State = "green" | "red" | "degraded";
export type ProbeState = State | "error";

/**
 * R25 A1: single source of truth for the known `Dimension` literal set.
 * The Zod enum in `src/rules/schema.ts` is derived from this array so rule
 * YAML authors who typo a dimension (e.g. `"smokee"`) are rejected at load
 * time with a clear "invalid enum value" message, instead of a misspelled
 * dimension passing a `z.string().min(1)` check and silently never matching
 * any probe key. Probe-key parsers (`deriveDimension` in alert-engine /
 * status-writer) stay permissive — they accept arbitrary `string` input and
 * fall back to `"unknown"` — because legacy/malformed probe keys must not
 * crash the engine. Rule side is closed; probe-key side stays open.
 */
export const DIMENSIONS = [
  "health",
  "smoke",
  "image_drift",
  "e2e_smoke",
  "pin_drift",
  "version_drift",
  "redirect_decommission",
  "deploy",
  "aimock_wiring",
  // L1-L4 buildout: per-starter depth signals side-emitted by the smoke
  // and e2e-smoke drivers. `agent` covers L2 (agent reachability from the
  // runtime), `chat` covers L3 (chat turn round-trip), `tools` covers L4
  // (tool invocation within a chat turn). Each emits as `<dim>:<slug>` so
  // deriveDimension() routes them to their dedicated rule YAMLs.
  "agent",
  "chat",
  "tools",
  // Phase 4A: QA dimension. The `qa` probe driver reads
  // `showcase/packages/<slug>/qa/<feature>.md` file presence and emits one
  // `qa:<slug>/<featureId>` row per manifest demo so the shell-dashboard
  // can render the per-cell QA badge (see shell-dashboard's
  // live-status.ts#resolveCell). The dimension does NOT contribute to the
  // rollup — it's informational only — but it still needs a closed-enum
  // slot so rule YAMLs that key on `qa` validate at load time.
  "qa",
  // Phase 4B: e2e-demos dimensions. The `e2e_demos` probe driver fans out
  // across every declared demo of a showcase service, emitting an
  // aggregate `e2e-demos:<slug>` row AND one `e2e:<slug>/<featureId>`
  // side row per demo. Both literals are closed-enum so probe config
  // YAMLs (`kind: e2e_demos`) and rule YAMLs filtering on
  // `dimension: e2e_demos` / `dimension: e2e` validate at load time.
  // `e2e` covers the per-cell side rows consumed by the dashboard's
  // `keyFor("e2e", slug, featureId)` lookup in live-status.ts#resolveCell.
  "e2e_demos",
  "e2e",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export type Severity = "info" | "warn" | "error" | "critical";

export type Transition =
  | "first"
  | "green_to_red"
  | "red_to_green"
  | "sustained_red"
  | "sustained_green"
  | "error";

export interface ProbeResult<Signal = unknown> {
  key: string;
  state: ProbeState;
  signal: Signal;
  observedAt: string;
}

export interface ProbeContext {
  now: () => Date;
  logger: Logger;
  env: Readonly<Record<string, string | undefined>>;
  /**
   * Optional side-emission writer. A driver that derives MORE THAN ONE
   * ProbeResult per invocation (e.g. smoke emits a paired `smoke:<slug>` +
   * `health:<slug>` tick off the same HTTP round-trip) pushes the auxiliary
   * results here; the invoker's `writer.write(driver.run(...))` call handles
   * the driver's PRIMARY return value as usual. Kept optional so single-
   * result drivers and legacy Probe call sites (which never see the
   * invoker-level StatusWriter) continue to construct ProbeContext without
   * plumbing a writer they don't need.
   */
  writer?: ProbeResultWriter;
  /**
   * Optional fetch injection for drivers that call out to the network
   * (image-drift → GHCR, redirect-decom → origin servers, ...). Added
   * as optional rather than required to avoid churning every existing
   * probe/driver test that constructs a plain `{ now, logger, env }`
   * ctx. Drivers that need network fall back to `globalThis.fetch`
   * when this is undefined; tests stub this field to avoid monkey-
   * patching globals. The probe-invoker passes the same `fetchImpl`
   * it hands to discovery sources so the two paths share one
   * injection point.
   */
  fetchImpl?: typeof fetch;
  /**
   * Optional cancellation signal, aborted by the invoker when a driver
   * exceeds its `timeout_ms`. Drivers that run long-lived work —
   * subprocesses, Playwright browsers, open sockets — SHOULD observe
   * this signal and abort in-flight work promptly; otherwise the
   * invoker still returns a synthetic timeout ProbeResult as soon as
   * the AbortController fires, but the driver's underlying work keeps
   * running until it completes naturally (resource leak). Drivers
   * that don't plumb this signal are unchanged behaviour-wise — the
   * invoker-level timeout still races them. Kept optional so existing
   * driver tests that construct a plain `{ now, logger, env }` ctx
   * continue to compile; drivers opt in over time.
   */
  abortSignal?: AbortSignal;
}

/**
 * Minimal writer surface the invoker injects into ProbeContext.writer. A
 * structural subset of StatusWriter (see `src/writers/status-writer.ts`) —
 * kept local to `types/` so `probes/` doesn't depend on `writers/` just to
 * declare this slot on the context. The invoker passes its real
 * `StatusWriter` into this slot at run time; the writer's return value
 * (WriteOutcome) is intentionally ignored by drivers — side-emitted
 * results flow through the same alert-engine pipeline as primary ticks.
 */
export interface ProbeResultWriter {
  write(result: ProbeResult<unknown>): Promise<unknown>;
}

export interface Probe<Input = void, Signal = unknown> {
  readonly dimension: string;
  run(input: Input, ctx: ProbeContext): Promise<ProbeResult<Signal>>;
}

export interface WriteOutcome {
  previousState: State | null;
  // HF-A6 / HF13-B2: `newState` must carry the probe's actual `"error"`
  // state end-to-end so dispatchCronAlert's synthesized outcome stops
  // lying about a fabricated red on error ticks. status-writer's error
  // branch now also sets `newState: "error"` (was: carried prior state
  // forward, which caused downstream consumers branching on
  // `newState === "error"` to miss live-write error ticks). If the prior
  // state is still needed (dashboards that want to keep rendering the
  // last-known non-error colour), it is carried on `errorStatePrev`.
  // Consumers that need to branch on error-vs-red MUST match on
  // `newState === "error"` OR `transition === "error"` depending on
  // which invariant they care about.
  newState: State | "error";
  /**
   * HF13-B2: when `newState === "error"`, this carries the prior durable
   * State (pre-error) so dashboards can continue to render the
   * last-known status colour while surfacing that the latest probe tick
   * errored. `null` when there was no prior observation (first-ever tick
   * is an error).
   */
  errorStatePrev?: State | null;
  transition: Transition;
  firstFailureAt: string | null;
  failCount: number;
}

export interface StatusRecord {
  id?: string;
  key: string;
  dimension: string;
  state: State;
  signal: unknown;
  observed_at: string;
  transitioned_at: string;
  fail_count: number;
  first_failure_at: string | null;
}

export interface StatusHistoryRecord {
  id?: string;
  key: string;
  dimension: string;
  state: State;
  transition: Transition;
  signal: unknown;
  observed_at: string;
}

export interface AlertStateRecord {
  id?: string;
  rule_id: string;
  dedupe_key: string;
  last_alert_at: string | null;
  last_alert_hash: string | null;
  payload_preview: string | null;
}

export interface RenderedMessage {
  payload: Record<string, unknown>;
  contentType: "application/json";
}

export interface TargetConfig {
  kind: string;
  webhook?: string;
  [k: string]: unknown;
}

export interface Target {
  readonly kind: string;
  send(rendered: RenderedMessage, config: TargetConfig): Promise<void>;
}

export interface TemplateContext {
  rule: { id: string; name: string; owner: string; severity: Severity };
  trigger: TriggerFlags;
  escalated: boolean;
  // HF-A3: winning escalation's `mention` (highest matching whenFailCount,
  // set on the escalation entry in the rule YAML). `undefined` when no
  // escalation matches OR when the matching escalation had no `mention`.
  // Templates render `{{escalationMention}}` — Mustache prints empty on
  // undefined so the absence case stays silent.
  escalationMention?: string;
  signal: Record<string, unknown>;
  event: {
    id: string;
    at: string;
    runId?: string;
    runUrl?: string;
    jobUrl?: string;
  };
  env: { dashboardUrl: string; repo: string };
  lastAlertAgeMin?: number;
}

export interface TriggerFlags {
  green_to_red: boolean;
  red_to_green: boolean;
  sustained_red: boolean;
  sustained_green: boolean;
  first: boolean;
  set_changed: boolean;
  cancelled_prebuild: boolean;
  cancelled_midmatrix: boolean;
  stable: boolean;
  regressed: boolean;
  improved: boolean;
  set_drifted: boolean;
  // set_errored mirrors set_drifted but keys on the probe's `errored` bucket
  // (invariant probes surface pure-errored ticks as state:"red" with no
  // unwired set). See alert-engine.deriveSignalFlags.
  set_errored: boolean;
  // gate_skipped: derived from `signal.gateSkipped === true`. The showcase
  // deploy workflow posts a gate-skipped payload (lockfile/detect-changes
  // gate blocked the build matrix before any deploys) that resolves to
  // state:"green" / failedCount:0 — without a derived signal flag no
  // trigger matches and the tick is silently dropped. See HF13-E1.
  gate_skipped: boolean;
  isRedTick: boolean;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

export function emptyTriggerFlags(): TriggerFlags {
  return {
    green_to_red: false,
    red_to_green: false,
    sustained_red: false,
    sustained_green: false,
    first: false,
    set_changed: false,
    cancelled_prebuild: false,
    cancelled_midmatrix: false,
    stable: false,
    regressed: false,
    improved: false,
    set_drifted: false,
    set_errored: false,
    gate_skipped: false,
    isRedTick: false,
  };
}
