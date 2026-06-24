export type State = "green" | "red" | "degraded";
export type ProbeState = State | "error";

/**
 * A6 (round 6): canonical home for the known durable-colour set and its
 * validator. Both `writers/status-writer.ts` and
 * `fleet/control-plane/result-aggregator.ts` previously carried private
 * replicas because importing one from the other would create an import
 * cycle (result-aggregator imports OverlayWriteOutcome from status-writer);
 * `types/` sits below both, breaking the cycle. Degrade-don't-trust
 * posture: a corrupt/legacy value read back from PB is treated as "no
 * prior observation" (undefined) rather than flowing into the transition
 * detector or a PB required-select column.
 */
// A6 (round 7): EXHAUSTIVE over the State union — `satisfies State[]` only
// checked that members were valid States, so a State added to the union
// (or a member dropped here) silently left KNOWN_STATES incomplete and
// every asKnownState consumer degrading valid values to "no prior
// observation". `satisfies Record<State, true>` errors at compile time on
// BOTH a missing and an extra key.
const KNOWN_STATE_FLAGS = {
  green: true,
  red: true,
  degraded: true,
} as const satisfies Record<State, true>;

export const KNOWN_STATES: ReadonlySet<string> = new Set(
  Object.keys(KNOWN_STATE_FLAGS),
);

export function asKnownState(value: unknown): State | undefined {
  return typeof value === "string" && KNOWN_STATES.has(value)
    ? (value as State)
    : undefined;
}

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
  // CROSS-ENV pin-drift (U6/U11, spec §7.3). The `pin_drift_cross_env`
  // driver reads BOTH prod (pinned) and staging (floating) running digests
  // and asserts prod is RUNNING the digest it was LAST PROMOTED to AND that
  // the digest is still present in GHCR — distinct from `image_drift`
  // (one env vs GHCR `:latest`) and `pin_drift` (the validate-pins ratchet).
  // The Ops surface routes PROD services here and STAGING to `image_drift`
  // (see probes/ops-drift-routing.ts). Closed-enum slot so its YAML
  // (`config/probes/cross-env-pin-drift.yml`) and rule keys validate at load.
  "pin_drift_cross_env",
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
  // `showcase/integrations/<slug>/qa/<feature>.md` file presence and emits one
  // `qa:<slug>/<featureId>` row per manifest demo so the shell-dashboard
  // can render the per-cell QA badge (see shell-dashboard's
  // live-status.ts#resolveCell). The dimension does NOT contribute to the
  // rollup — it's informational only — but it still needs a closed-enum
  // slot so rule YAMLs that key on `qa` validate at load time.
  "qa",
  // Phase 4B: e2e-demos dimensions. The `e2e_demos` probe driver fans out
  // across every declared demo of a showcase service, emitting an
  // aggregate `e2e-demos:<slug>` row (key_template in
  // config/probes/e2e-demos.yml) AND one `e2e:<slug>/<featureId>` side
  // row per demo. `e2e_demos` (underscore) is the probe KIND literal
  // (`kind: e2e_demos` in probe config YAMLs); `e2e-demos` (hyphen) is
  // the EMIT-prefix dimension deriveDimension() records on persisted
  // aggregate rows — the same kind/emit-prefix split as e2e_d6/d6 and
  // starter_smoke/starter below. Rule YAMLs matching the aggregate rows
  // must therefore filter on `dimension: e2e-demos`, NOT `e2e_demos`
  // (which validates but never matches a persisted row). `e2e` covers
  // the per-cell side rows consumed by the dashboard's
  // `keyFor("e2e", slug, featureId)` lookup in live-status.ts#resolveCell.
  "e2e_demos",
  "e2e-demos",
  "e2e",
  // D5 — "D6 take-one". D5 no longer has its own driver kind: the
  // `config/probes/e2e-deep.yml` probe runs `kind: e2e_d6` scoped to a
  // single representative pill per feature category, emitting per-feature
  // side rows under `d5:<slug>/<featureType>` keys. `e2e_deep` and `d5`
  // are retained ONLY as closed-enum dimension/emit literals (rule YAMLs
  // and legacy rows still reference them); neither is a live driver kind.
  "e2e_deep",
  "d5",
  // D6 — full end-to-end driver. `e2e_d6` is the primary `kind:` literal
  // in `config/probes/e2e-d6.yml`; the driver emits aggregate rows under
  // this dimension while per-feature side rows use the `d6:` prefix
  // (same pattern as e2e_demos/e2e).
  "e2e_d6",
  "d6",
  // System-level dimension. The `system` dimension covers infrastructure-
  // level signals (e.g. discovery auth status) that are not tied to any
  // specific probe driver but need closed-enum validation in rule YAMLs.
  "system",
  // Starter-smoke dimension. The `starter_smoke` probe family fans out
  // across the deployed per-starter Railway services and side-emits one
  // row per smoke level: `starter:<column-slug>/<level>` where level ∈
  // {health,agent,chat,interaction}, plus an aggregate `starter:<col>`
  // primary. The starter slug is remapped to the dashboard COLUMN slug
  // (see probes/helpers/starter-mapping.ts) before emit so the dashboard
  // only ever sees column slugs. The per-level sub-key does NOT collide
  // with the `agent`/`chat`/`tools` depth dimensions above: those are
  // separate dimensions keyed `<dim>:<slug>` (e.g. `agent:langgraph-python`),
  // whereas the starter levels live UNDER the `starter` dimension as the
  // `<level>` suffix (`starter:langgraph-python/agent`) — disjoint key
  // spaces because the dimension prefix differs. Informational only; like
  // d5/d6/qa it must NOT contribute to the feature-cell rollup.
  //
  // `starter_smoke` is the probe KIND literal (`kind: starter_smoke` in
  // config/probes/starter_smoke.yml, and the `kind` the starterSmokeDriver
  // registers under), distinct from the `starter` EMIT-prefix dimension
  // above — the same kind/emit-prefix split as e2e_d6/d6 and
  // e2e_demos/e2e. Without this closed-enum slot the probe-loader's Zod
  // `kind` enum rejects starter_smoke.yml at parse time (union failure
  // surfacing as "Unrecognized key(s): 'discovery'"), so the probe never
  // loads and probe-loader.test.ts's shipped-config check fails.
  "starter_smoke",
  "starter",
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
  /**
   * Optional drain reason set by the invoker when `abortSignal` fires as part
   * of a GRACEFUL worker shutdown (SIGTERM/redeploy), as opposed to a per-run
   * timeout or an error abort. When `"shutdown"`, drivers SHOULD suppress the
   * red per-cell side-emits they would otherwise write for not-yet-completed
   * work — a graceful drain must not paint a mass-red block on the dashboard
   * (the worker abandons the partial job so the lease lapses into the sweeper's
   * neutral-gray re-queue instead). Drivers that don't understand this field
   * ignore it — it's purely advisory. Kept optional so existing ProbeContext
   * construction sites (tests, legacy drivers) continue to compile.
   */
  drainReason?: "shutdown";
  /**
   * Optional feature-type filter threaded from the trigger layer. When
   * set, drivers that support per-feature-type filtering (e.g. e2e-deep)
   * SHOULD restrict their run to only the listed feature types. Drivers
   * that don't understand feature types ignore this field — it's purely
   * advisory. Kept optional so existing ProbeContext construction sites
   * (tests, legacy drivers) continue to compile without changes.
   */
  featureTypes?: string[];
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
  /**
   * Whether this outcome reflects a write that actually reached durable
   * storage (A2 — required and truthful; no absence-encoding). The real
   * status-writer stamps it everywhere: `true` on a durable status-row
   * upsert success and on an error-path `observed_at` refresh that
   * persisted; `false` on the three non-persisted error-path exits
   * (first-ever error with no row, stale/unparseable observed_at skip,
   * swallowed `pb.update` failure) AND on the durable path's
   * unparseable-observedAt skip (round-8 #7: a fourth real-writer false
   * exit — there `newState` carries the OBSERVED colour while
   * `transition` is "error" and the durable row is unchanged; see the F2e
   * posture in status-writer.ts). Best-effort wrappers (e.g. the CLI's
   * `bestEffortWriter`) synthesize outcomes with `persisted: false` when
   * the underlying write threw — there, `errorStatePrev: null` means
   * "prior state unknown" (the write never reached PB), NOT "no prior
   * observation / first-ever error tick".
   */
  persisted: boolean;
}

export interface StatusRecord {
  id?: string;
  key: string;
  dimension: string;
  state: State;
  signal: unknown;
  observed_at: string;
  /**
   * When the row last changed durable state. NOTE (A2): PocketBase
   * serializes an UNSET date field as `""` (never null/absent), so legacy
   * rows can carry `transitioned_at: ""` — consumers must normalize with
   * truthiness (`||`), not nullish checks, the same posture documented on
   * `first_failure_at` / `state_written_at` below.
   */
  transitioned_at: string;
  fail_count: number;
  /**
   * When the current red/degraded streak began; null once recovered. NOTE
   * (A1): PocketBase serializes an UNSET date field as `""` (never
   * null/absent), so rows read back from PB carry `first_failure_at: ""`
   * where this type says null — consumers must normalize with truthiness
   * (`|| null`), not nullish checks, the same posture documented on
   * `state_written_at` below.
   */
  first_failure_at: string | null;
  /**
   * Writer-identity stamp (anti-dual-writer hardening): the role+service of
   * the process that wrote this row's durable state (e.g. "legacy",
   * "fleet-cp", "cli" — same role-naming family as the fleet's
   * `worker-<id>` identifiers). Optional: rows CREATED before the
   * `status_add_written_by` migration (or created fresh by an old image)
   * lack it. NOTE (round-6 A1, supersedes round-5 A6iv): during the
   * legacy/fleet coexistence window an old-image UPDATE of a row a
   * new-image writer already stamped leaves the stale stamp in place (PB
   * updates only the fields provided) — so the stamped writer's next write
   * sees written_by === itself and cross-writer flip detection is
   * detection-BLIND for these same-identity flips (not merely
   * mis-attributing them). Mitigated within a process lifetime by the
   * writer's in-memory self-write map (the
   * `status-writer.foreign-write-detected` heuristic — silent across
   * restarts); the window closes when the legacy writer is decommissioned.
   * Stamped at the status-writer chokepoint on every
   * durable state write; error ticks refresh `observed_at` WITHOUT
   * restamping, so attribution always follows the writer that produced
   * the persisted state, not the last process that merely observed an
   * error.
   */
  written_by?: string;
  /**
   * Timestamp of the last DURABLE STATE write (the full status-row upsert
   * that also stamps `written_by`). Distinct from `observed_at`: error
   * ticks refresh `observed_at` without restamping `written_by`, so
   * `observed_at` can decouple from the attribution. The cross-writer
   * flip window is measured against this field so a months-old durable
   * state with a recent error tick doesn't fabricate a "fight". Optional:
   * rows written before the `status_add_state_written_at` migration (or
   * by an old image) lack it — the writer falls back to `observed_at`,
   * which is conservative (may false-positive on the error-tick scenario
   * until the next durable write stamps the field). Note PocketBase
   * serializes unset date fields as `""` (never null/absent), so absence
   * manifests as an empty string and consumers must use truthiness, not
   * nullish checks.
   */
  state_written_at?: string;
}

/**
 * Audit note (F2e): `transition: "error"` rows are written by THREE distinct
 * paths in `src/writers/status-writer.ts` and are NOT distinguishable by the
 * transition value alone (the schema has no narrower literal; adding one
 * would be a breaking schema change):
 *
 *   1. Probe-error ticks (`write()` with `state: "error"`): `state` carries
 *      the prior durable colour (or a schema-required "green" placeholder
 *      when the key was never observed — see F2b in status-writer.ts) and
 *      `signal` is the probe's own error signal.
 *   2. Overlay audit rows (`writeOverlay()`, H1): `state` is the EXISTING
 *      row's preserved durable state and `signal` is the row's prior signal
 *      merged with the overlay fields — e.g. the fleet comm-error overlay
 *      under `FLEET_COMM_ERROR_SIGNAL_KEY` ("__fleetCommError", see
 *      fleet/contracts.ts).
 *   3. Durable-skip rows (A3 round 6: `write()` with an unparseable
 *      observedAt): the durable upsert is skipped, so the history row must
 *      not claim the computed transition (a phantom flip the durable row
 *      never made) — `state` carries the OBSERVED (non-persisted) colour
 *      and `signal` is the probe's signal.
 *
 * Auditors should distinguish these by the signal payload (overlay rows
 * carry the merged overlay keys), not by `state` or `transition`. History
 * rows carry no `written_by` column; writer attribution lives only on the
 * `status` row, which an overlay write deliberately does not restamp.
 */
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
  // `sourceEnv` labels the deploy environment the alerting harness is
  // running in ("staging" / "production" / "unknown"). Threaded so the
  // renderer can prefix every alert with a source-env tag — operators
  // triaging a red probe need to know whether staging or production is
  // affected, which the raw probe text never carried. Derived in the
  // orchestrator from RAILWAY_ENVIRONMENT_NAME (see AlertEngineDeps.env).
  // `sourceEnv` is optional at the type boundary so the many test fixtures
  // constructing a context need not all set it; production always supplies
  // it (orchestrator.ts), and the renderer defaults a missing/empty value
  // to `[unknown]` rather than dropping the tag.
  env: { dashboardUrl: string; repo: string; sourceEnv?: string };
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
