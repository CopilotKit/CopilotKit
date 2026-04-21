export type State = "green" | "red" | "degraded";
export type ProbeState = State | "error";
export type Dimension =
  | "health"
  | "smoke"
  | "image_drift"
  | "e2e_smoke"
  | "pin_drift"
  | "version_drift"
  | "redirect_decommission"
  | "deploy"
  | "aimock_wiring";

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
}

export interface Probe<Input = void, Signal = unknown> {
  readonly dimension: string;
  run(input: Input, ctx: ProbeContext): Promise<ProbeResult<Signal>>;
}

export interface WriteOutcome {
  previousState: State | null;
  newState: State;
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
    isRedTick: false,
  };
}
