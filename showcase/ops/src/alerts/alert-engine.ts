import crypto from "node:crypto";
import { ulid } from "ulid";
import Mustache from "mustache";
import type { TypedEventBus } from "../events/event-bus.js";
import type { Renderer } from "../render/renderer.js";
import type { CompiledRule } from "../rules/rule-loader.js";
import type { AlertStateStore } from "../storage/alert-state-store.js";
import {
  emptyTriggerFlags,
  type Logger,
  type ProbeResult,
  type Severity,
  type State,
  type Target,
  type TemplateContext,
  type Transition,
  type TriggerFlags,
  type WriteOutcome,
} from "../types/index.js";

export interface AlertEngineDeps {
  bus: TypedEventBus;
  renderer: Renderer;
  stateStore: AlertStateStore;
  targets: Map<string, Target>;
  logger: Logger;
  now: () => Date;
  env: { dashboardUrl: string; repo: string };
  /** Milliseconds after boot during which green_to_red is suppressed. */
  bootstrapWindowMs?: number;
}

export interface AlertEngine {
  start(): void;
  stop(): void;
  reload(rules: CompiledRule[]): void;
}

export function createAlertEngine(deps: AlertEngineDeps): AlertEngine {
  const { bus, renderer, stateStore, targets, logger, now, env } = deps;
  const bootstrapWindowMs = deps.bootstrapWindowMs ?? 15 * 60_000;
  const bootTime = now().getTime();
  let rules: CompiledRule[] = [];
  const unsubs: Array<() => void> = [];

  function bootstrapActive(): boolean {
    return now().getTime() - bootTime < bootstrapWindowMs;
  }

  async function handleStatusChanged(evt: {
    outcome: WriteOutcome;
    result: ProbeResult<unknown>;
  }): Promise<void> {
    for (const rule of rules) {
      try {
        if (rule.signal.dimension !== deriveDimension(evt.result.key)) continue;
        if (!filterMatchesKey(rule, evt.result.key)) continue;

        if (evt.outcome.transition === "error") {
          // Apply the same guard-set to onError paths so minDeployAgeMin (and
          // any future guard) gate error alerts identically to normal ones.
          if (rule.onError && passesGuards(rule, evt)) {
            await dispatchOnError(rule, evt);
          }
          continue;
        }

        const t = evt.outcome.transition as Transition;
        const signalFlags = deriveSignalFlags(evt.result.signal);
        const triggered = resolveTriggers(rule, t, signalFlags);
        if (triggered.length === 0) {
          // Dormant rule — surface enough context to diagnose silent zeros
          // without spamming at info level.
          logger.debug("alert-engine.no-triggers-matched", {
            ruleId: rule.id,
            transition: t,
            signalFlags,
            declared: rule.stringTriggers,
          });
          continue;
        }

        // Bootstrap suppression: a freshly-booted service with no prior state
        // observes every failing key as either `green_to_red` (fresh write over
        // an existing green record) or `first` with state=red (no prior record).
        // Both are false-positives for alerting purposes.
        const isFreshRed =
          triggered.includes("green_to_red") ||
          (triggered.includes("first") && evt.outcome.newState === "red");
        if (isFreshRed && bootstrapActive()) {
          logger.info("alert-engine.bootstrap-suppress", {
            ruleId: rule.id,
            key: evt.result.key,
            reason: "bootstrap_first_observation",
          });
          continue;
        }

        if (!passesGuards(rule, evt)) continue;
        if (await shouldSuppress(rule, evt, triggered)) continue;
        await dispatchAlert(rule, evt, triggered);
      } catch (err) {
        logger.error("alert-engine.rule-handler-failed", {
          ruleId: rule.id,
          err: String(err),
        });
      }
    }
  }

  async function handleRuleScheduled(evt: {
    ruleId: string;
    scheduledAt: string;
    result?: ProbeResult<unknown>;
  }): Promise<void> {
    const rule = rules.find((r) => r.id === evt.ruleId);
    if (!rule) return;
    // For cron-only rules without a prior error, render directly with whatever
    // signal the probe produced (may be undefined for probe-less rules).
    await dispatchCronAlert(rule, evt);
  }

  function filterMatchesKey(rule: CompiledRule, key: string): boolean {
    const filter = rule.signal.filter;
    if (!filter) return true;
    // key format: dimension:rest  where rest may be slug, slug/featureId, or
    // a composite key. `split(":", 2)` truncates the 3rd+ segment entirely;
    // use indexOf to preserve any embedded colons in `rest` (e.g. an e2e
    // smoke key like `e2e_smoke:mastra:checkout-feature`).
    const colonIdx = key.indexOf(":");
    const keyDim = colonIdx > 0 ? key.slice(0, colonIdx) : "";
    const rest = colonIdx >= 0 ? key.slice(colonIdx + 1) : "";
    const slug = rest.split("/")[0];
    // filter.key matches against the post-dimension portion (spec examples use
    // e.g. `key: overall` against `deploy:overall`).
    if (filter.key && !globMatch(filter.key, rest)) return false;
    if (filter.slug && !globMatch(filter.slug, slug ?? "")) return false;
    // filter.dimension — compared against the event's actual dimension (the
    // prefix of its key), not the rule's own declared dimension (that was a
    // tautology and always true).
    if (filter.dimension && filter.dimension !== keyDim) return false;
    // kind is external metadata — we don't track it here; pass through.
    return true;
  }

  /**
   * Enforce any `minDeployAgeMin` guard. If the rule demands it but the event
   * has no `signal.deployedAt`, we log a warning and let the alert through
   * (fail-open so missing instrumentation doesn't silence alerts entirely).
   */
  function passesGuards(
    rule: CompiledRule,
    evt: { outcome: WriteOutcome; result: ProbeResult<unknown> },
  ): boolean {
    for (const g of rule.conditions.guards) {
      if (g.minDeployAgeMin == null) continue;
      const sig = signalAsObject(evt.result.signal);
      const deployedAt = sig["deployedAt"];
      if (typeof deployedAt !== "string" || deployedAt.length === 0) {
        logger.warn("alert-engine.guard-no-deployedAt", {
          ruleId: rule.id,
          guard: "minDeployAgeMin",
        });
        continue;
      }
      const ageMin =
        (now().getTime() - new Date(deployedAt).getTime()) / 60_000;
      if (ageMin < g.minDeployAgeMin) {
        logger.debug("alert-engine.guard-suppress", {
          ruleId: rule.id,
          guard: "minDeployAgeMin",
          ageMin,
          threshold: g.minDeployAgeMin,
        });
        return false;
      }
    }
    return true;
  }

  function buildDedupeKey(
    rule: CompiledRule,
    evt: { outcome: WriteOutcome; result: ProbeResult<unknown> },
    triggered: string[],
  ): string {
    const fallbackTrigger = triggered[0] ?? evt.outcome.transition;
    const perKeyTmpl = rule.conditions.rate_limit?.perKey;
    if (perKeyTmpl) {
      try {
        const ctx = buildContext(rule, evt, triggered);
        // Keep `trigger` as the flags object so section templates like
        // `{{#trigger.green_to_red}}...{{/trigger.green_to_red}}` continue
        // to work. Expose the matched trigger *name* separately under
        // `triggerName` — prior versions shadowed the flag object with the
        // string, which silently broke every template relying on sections.
        const ctxWithTrigger = {
          ...ctx,
          triggerName: fallbackTrigger,
        } as unknown as Record<string, unknown>;
        const rendered = Mustache.render(perKeyTmpl, ctxWithTrigger);
        if (rendered.trim().length > 0) return rendered;
      } catch (err) {
        logger.warn("alert-engine.perKey-render-failed", {
          ruleId: rule.id,
          err: String(err),
        });
      }
    }
    return `${evt.result.key}:${fallbackTrigger}`;
  }

  async function shouldSuppress(
    rule: CompiledRule,
    evt: { outcome: WriteOutcome; result: ProbeResult<unknown> },
    triggered: string[],
  ): Promise<boolean> {
    const transition = evt.outcome.transition;
    const dedupeKey = buildDedupeKey(rule, evt, triggered);
    const last = await stateStore.get(rule.id, dedupeKey);
    const ageMin = last?.last_alert_at
      ? (now().getTime() - new Date(last.last_alert_at).getTime()) / 60_000
      : Number.POSITIVE_INFINITY;

    // Suppression expression eval (limited DSL):
    //   trigger == "sustained_red" && lastAlertAgeMin < 15
    if (rule.conditions.suppress) {
      const vars = {
        trigger: triggered[0] ?? transition,
        lastAlertAgeMin: ageMin,
      };
      if (evalSuppress(rule.conditions.suppress.when, vars)) {
        logger.debug("alert-engine.suppressed", {
          rule: rule.id,
          reason: "expression",
        });
        return true;
      }
    }

    // Rate limit
    if (rule.conditions.rate_limit && rule.conditions.rate_limit.window) {
      const windowMs = parseDuration(rule.conditions.rate_limit.window);
      if (last?.last_alert_at) {
        const elapsed =
          now().getTime() - new Date(last.last_alert_at).getTime();
        if (elapsed < windowMs) {
          logger.debug("alert-engine.rate-limited", { rule: rule.id });
          return true;
        }
      }
    }

    return false;
  }

  async function dispatchAlert(
    rule: CompiledRule,
    evt: { outcome: WriteOutcome; result: ProbeResult<unknown> },
    triggered: string[],
  ): Promise<void> {
    const lastAlertAgeMin = await fetchLastAlertAgeMin(rule, evt, triggered);
    const ctx = buildContext(rule, evt, triggered, lastAlertAgeMin);
    if (!rule.template) return;
    const rendered = renderer.render(rule.template, ctx);
    const sent = await sendToTargets(rule, rendered);
    if (!sent) {
      logger.warn("alert-engine.record-skipped", {
        rule: rule.id,
        reason: "all-targets-failed",
      });
      return;
    }
    const hash = hashPayload(rendered.payload);
    const preview = JSON.stringify(rendered.payload).slice(0, 500);
    const dedupeKey = buildDedupeKey(rule, evt, triggered);
    await stateStore.record(rule.id, dedupeKey, {
      at: now().toISOString(),
      hash,
      preview,
    });
  }

  async function dispatchOnError(
    rule: CompiledRule,
    evt: { outcome: WriteOutcome; result: ProbeResult<unknown> },
  ): Promise<void> {
    if (!rule.onError) return;
    const triggered = ["error"];
    // Apply the same dedupe / rate-limit / bootstrap gates as dispatchAlert
    // so error alerts don't flood on a stuck probe.
    if (bootstrapActive()) {
      logger.info("alert-engine.bootstrap-suppress", {
        ruleId: rule.id,
        key: evt.result.key,
        reason: "bootstrap_onError",
      });
      return;
    }
    if (await shouldSuppress(rule, evt, triggered)) return;
    const lastAlertAgeMin = await fetchLastAlertAgeMin(rule, evt, triggered);
    const ctx = buildContext(rule, evt, triggered, lastAlertAgeMin);
    const rendered = renderer.render(rule.onError.template, ctx);
    const sent = await sendToTargets(rule, rendered);
    if (!sent) {
      logger.warn("alert-engine.record-skipped", {
        rule: rule.id,
        reason: "all-targets-failed",
        path: "onError",
      });
      return;
    }
    const hash = hashPayload(rendered.payload);
    const preview = JSON.stringify(rendered.payload).slice(0, 500);
    const dedupeKey = buildDedupeKey(rule, evt, triggered);
    await stateStore.record(rule.id, dedupeKey, {
      at: now().toISOString(),
      hash,
      preview,
    });
  }

  async function dispatchCronAlert(
    rule: CompiledRule,
    evt: { ruleId: string; scheduledAt: string; result?: ProbeResult<unknown> },
  ): Promise<void> {
    if (!rule.template) return;
    const probeState = evt.result?.state;
    // If the probe reports error, downstream WriteOutcome should keep the
    // alert engine's state-machine in a consistent shape — newState must be
    // one of the real `State` values. Default to "green" when missing.
    const resolvedState: State =
      probeState === "red" || probeState === "degraded" ? probeState : "green";
    // Thread fail-tracking from the probe signal if present, so escalations
    // (`whenFailCount >= N`) fire on cron-driven rules too. Upstream jobs
    // that POST results via rule.scheduled may include failCount/firstFailureAt
    // on the signal object.
    const probeSignal =
      evt.result && typeof evt.result.signal === "object" && evt.result.signal
        ? (evt.result.signal as Record<string, unknown>)
        : {};
    const signalFailCount =
      typeof probeSignal["failCount"] === "number"
        ? (probeSignal["failCount"] as number)
        : 0;
    const signalFirstFailureAt =
      typeof probeSignal["firstFailureAt"] === "string"
        ? (probeSignal["firstFailureAt"] as string)
        : null;
    const outcome: WriteOutcome = {
      previousState: null,
      newState: resolvedState,
      transition: "first",
      firstFailureAt: signalFirstFailureAt,
      failCount: signalFailCount,
    };
    const fakeResult: ProbeResult<unknown> = evt.result ?? {
      key: `${rule.signal.dimension}:scheduled`,
      state: "green",
      signal: {},
      observedAt: evt.scheduledAt,
    };
    if (fakeResult.state === "error" && rule.onError) {
      await dispatchOnError(rule, { outcome, result: fakeResult });
      return;
    }
    const triggered = ["first"];
    // Apply same dedupe + rate-limit gating as status.changed alerts. Bootstrap
    // suppression must ONLY kick in when the transition looks like a "fresh
    // red" (mirror handleStatusChanged's isFreshRed gate) — green/degraded
    // scheduled reports are valid even inside the bootstrap window.
    const isFreshRed = resolvedState === "red";
    if (isFreshRed && bootstrapActive()) {
      logger.info("alert-engine.bootstrap-suppress", {
        ruleId: rule.id,
        key: fakeResult.key,
        reason: "bootstrap_cron_fresh_red",
      });
      return;
    }
    if (!passesGuards(rule, { outcome, result: fakeResult })) return;
    if (await shouldSuppress(rule, { outcome, result: fakeResult }, triggered))
      return;
    const lastAlertAgeMin = await fetchLastAlertAgeMin(
      rule,
      { outcome, result: fakeResult },
      triggered,
    );
    const ctx = buildContext(
      rule,
      { outcome, result: fakeResult },
      triggered,
      lastAlertAgeMin,
    );
    const rendered = renderer.render(rule.template, ctx);
    const sent = await sendToTargets(rule, rendered);
    if (!sent) {
      logger.warn("alert-engine.record-skipped", {
        rule: rule.id,
        reason: "all-targets-failed",
        path: "cron",
      });
      return;
    }
    const hash = hashPayload(rendered.payload);
    const preview = JSON.stringify(rendered.payload).slice(0, 500);
    const dedupeKey = buildDedupeKey(
      rule,
      { outcome, result: fakeResult },
      triggered,
    );
    await stateStore.record(rule.id, dedupeKey, {
      at: now().toISOString(),
      hash,
      preview,
    });
  }

  async function sendToTargets(
    rule: CompiledRule,
    rendered: {
      payload: Record<string, unknown>;
      contentType: "application/json";
    },
  ): Promise<boolean> {
    // Returns true iff at least one target successfully received the payload.
    // Callers use this to decide whether to record dedupe state — recording
    // on an all-failed send would silently swallow the outage on retry.
    let anySucceeded = false;
    for (const t of rule.targets) {
      const adapter = targets.get(t.kind);
      if (!adapter) {
        logger.warn("alert-engine.no-target-adapter", {
          rule: rule.id,
          kind: t.kind,
        });
        continue;
      }
      try {
        await adapter.send(rendered, t);
        anySucceeded = true;
      } catch (err) {
        logger.error("alert-engine.target-failed", {
          rule: rule.id,
          kind: t.kind,
          err: String(err),
        });
      }
    }
    return anySucceeded;
  }

  function buildContext(
    rule: CompiledRule,
    evt: { outcome: WriteOutcome; result: ProbeResult<unknown> },
    triggered: string[],
    lastAlertAgeMin?: number,
  ): TemplateContext {
    const flags = emptyTriggerFlags();
    const mutableFlags = flags as unknown as Record<string, boolean>;
    for (const name of triggered) {
      if (name in flags) mutableFlags[name] = true;
    }
    flags.isRedTick = flags.green_to_red || flags.sustained_red;
    // Escalation check: at or past the configured fail count boundary so
    // operators keep seeing escalations on every tick past the threshold
    // (rate-limit governs frequency).
    let escalated = false;
    let severity: Severity = rule.severity;
    for (const esc of rule.conditions.escalations) {
      if (evt.outcome.failCount >= esc.whenFailCount) {
        escalated = true;
        if (esc.severity) severity = esc.severity;
      }
    }
    const baseSignal = signalAsObject(evt.result.signal);
    // Thread canonical CI metadata from probe signal into event.* so
    // templates can uniformly reference `{{event.runUrl}}` / `{{event.runId}}`
    // / `{{event.jobUrl}}` regardless of dimension. Missing values render
    // as empty strings (Mustache default).
    const runUrl =
      typeof baseSignal["runUrl"] === "string"
        ? (baseSignal["runUrl"] as string)
        : "";
    const runId =
      typeof baseSignal["runId"] === "string"
        ? (baseSignal["runId"] as string)
        : "";
    const jobUrl =
      typeof baseSignal["jobUrl"] === "string"
        ? (baseSignal["jobUrl"] as string)
        : "";
    return {
      rule: { id: rule.id, name: rule.name, owner: rule.owner, severity },
      trigger: flags,
      escalated,
      signal: {
        ...baseSignal,
        failCount: evt.outcome.failCount,
        firstFailureAt: evt.outcome.firstFailureAt,
      },
      event: {
        id: ulid(),
        at: evt.result.observedAt,
        runId,
        runUrl,
        jobUrl,
      },
      env,
      lastAlertAgeMin,
    };
  }

  /**
   * Fetch the last alert age (in minutes) for the dedupe-key derived from
   * this rule/event/triggered-list. Returns `undefined` when there's no
   * prior record — templates then render `{{lastAlertAgeMin}}` as empty.
   * Kept silent on lookup failure: a store error must not kill dispatch.
   */
  async function fetchLastAlertAgeMin(
    rule: CompiledRule,
    evt: { outcome: WriteOutcome; result: ProbeResult<unknown> },
    triggered: string[],
  ): Promise<number | undefined> {
    try {
      const key = buildDedupeKey(rule, evt, triggered);
      const last = await stateStore.get(rule.id, key);
      if (!last?.last_alert_at) return undefined;
      const ms = now().getTime() - new Date(last.last_alert_at).getTime();
      return ms / 60_000;
    } catch (err) {
      logger.warn("alert-engine.lastAlertAge-lookup-failed", {
        ruleId: rule.id,
        err: String(err),
      });
      return undefined;
    }
  }

  return {
    start() {
      unsubs.push(
        bus.on("status.changed", (e) =>
          handleStatusChanged(e).catch((err) =>
            logger.error("alert-engine.handler-failed", {
              err: String(err),
              handler: "status.changed",
            }),
          ),
        ),
      );
      unsubs.push(
        bus.on("rule.scheduled", (e) =>
          handleRuleScheduled(e).catch((err) =>
            logger.error("alert-engine.handler-failed", {
              err: String(err),
              handler: "rule.scheduled",
            }),
          ),
        ),
      );
    },
    stop() {
      for (const u of unsubs) u();
      unsubs.length = 0;
    },
    reload(next) {
      rules = next;
    },
  };
}

function deriveDimension(key: string): string {
  const idx = key.indexOf(":");
  return idx > 0 ? key.slice(0, idx) : "unknown";
}

function signalAsObject(signal: unknown): Record<string, unknown> {
  return typeof signal === "object" && signal !== null
    ? (signal as Record<string, unknown>)
    : {};
}

/**
 * Compute signal-derived trigger flags from a probe result signal (§2.1.5).
 * Set-based / deploy-specific triggers are not transitions — they're derived
 * from signal content and surfaced alongside the state-machine transition.
 */
function deriveSignalFlags(
  signal: unknown,
): Partial<Record<keyof TriggerFlags, boolean>> {
  const flags: Partial<Record<keyof TriggerFlags, boolean>> = {};
  if (typeof signal !== "object" || signal === null) return flags;
  const s = signal as Record<string, unknown>;

  // Deploy-specific
  if (s.cancelledMidMatrix === true) flags.cancelled_midmatrix = true;
  if (s.cancelledPreBuild === true) flags.cancelled_prebuild = true;

  // Set-based: fires when the set of triggered/stale items changed since last observation.
  // This is a best-effort computation from current signal alone; persistent set-diff
  // tracking will come via alert_state in later phases.
  const triggeredArr = Array.isArray(s.triggered)
    ? (s.triggered as unknown[])
    : null;
  if (triggeredArr && triggeredArr.length > 0) flags.set_changed = true;

  // Set-drifted: fires when a probe reports a non-empty `unwired` set. Used
  // by invariant-style probes (e.g. aimock-wiring, spec §6.4) whose red-state
  // IS the drift — no separate state transition needed.
  const unwiredArr = Array.isArray(s.unwired) ? (s.unwired as unknown[]) : null;
  if (unwiredArr && unwiredArr.length > 0) flags.set_drifted = true;

  return flags;
}

/**
 * Resolve which declared triggers on a rule actually fire for this event.
 * Combines the state-machine transition with signal-derived flags; returns
 * names in rule declaration order so dedupe behavior is stable.
 */
function resolveTriggers(
  rule: CompiledRule,
  transition: Transition,
  signalFlags: Partial<Record<keyof TriggerFlags, boolean>>,
): string[] {
  const matched: string[] = [];
  for (const declared of rule.stringTriggers) {
    if (declared === transition) {
      matched.push(declared);
      continue;
    }
    if ((signalFlags as Record<string, boolean>)[declared]) {
      matched.push(declared);
    }
  }
  return matched;
}

function globMatch(pattern: string, value: string): boolean {
  if (!pattern.includes("*")) return pattern === value;
  const re = new RegExp(
    "^" +
      pattern
        .split("*")
        .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
  );
  return re.test(value);
}

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(spec: string | number): number {
  if (typeof spec === "number") return spec;
  const m = spec.match(/^(\d+)([smhd])$/);
  if (!m) throw new Error(`invalid duration: ${spec}`);
  const [, num, unit] = m;
  return Number(num) * UNIT_MS[unit!]!;
}

/**
 * Order-independent payload hash: sort keys recursively so logically-equivalent
 * payloads produce the same digest regardless of object-literal key order.
 */
function hashPayload(payload: Record<string, unknown>): string {
  return crypto
    .createHash("sha256")
    .update(stableStringify(payload))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v;
    const obj = v as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
    return sorted;
  });
}

/**
 * Minimal expression evaluator for YAML `conditions.suppress.when`.
 * Supports: identifiers, string literals ("..." or '...'), number literals,
 * boolean/null, binary ops (==, !=, <=, >=, <, >), logical (&&, ||), unary !,
 * and parenthesized sub-expressions.
 *
 * Rejects any other syntax — in particular no function calls, member access,
 * indexing, or object/array literals — so YAML-authored suppression rules
 * cannot reach arbitrary JS.
 */
export function evalSuppress(
  expr: string,
  vars: Record<string, unknown>,
): boolean {
  try {
    const tokens = tokenizeSuppress(expr);
    const parser = new SuppressParser(tokens, vars);
    const value = parser.parseOr();
    parser.expectEnd();
    return Boolean(value);
  } catch (err) {
    throw new Error(`invalid suppress expression: ${expr} (${String(err)})`);
  }
}

type Tok =
  | { t: "ident"; v: string }
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "null" }
  | {
      t: "op";
      v: "==" | "!=" | "<=" | ">=" | "<" | ">" | "&&" | "||" | "!" | "(" | ")";
    };

function tokenizeSuppress(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let value = "";
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < src.length) {
          value += src[j + 1];
          j += 2;
        } else {
          value += src[j];
          j++;
        }
      }
      if (src[j] !== quote) throw new Error(`unterminated string at ${i}`);
      out.push({ t: "str", v: value });
      i = j + 1;
      continue;
    }
    if (c >= "0" && c <= "9") {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new Error(`bad number at ${i}`);
      out.push({ t: "num", v: n });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      const word = src.slice(i, j);
      if (word === "true") out.push({ t: "bool", v: true });
      else if (word === "false") out.push({ t: "bool", v: false });
      else if (word === "null") out.push({ t: "null" });
      else out.push({ t: "ident", v: word });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (
      two === "==" ||
      two === "!=" ||
      two === "<=" ||
      two === ">=" ||
      two === "&&" ||
      two === "||"
    ) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if (c === "<" || c === ">" || c === "!" || c === "(" || c === ")") {
      out.push({
        t: "op",
        v: c as "<" | ">" | "!" | "(" | ")",
      });
      i++;
      continue;
    }
    throw new Error(`unexpected character ${JSON.stringify(c)} at ${i}`);
  }
  return out;
}

class SuppressParser {
  private pos = 0;
  constructor(
    private readonly tokens: Tok[],
    private readonly vars: Record<string, unknown>,
  ) {}

  private peek(): Tok | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Tok {
    const t = this.tokens[this.pos++];
    if (!t) throw new Error("unexpected end of expression");
    return t;
  }

  expectEnd(): void {
    if (this.pos !== this.tokens.length)
      throw new Error(`unexpected token at pos ${this.pos}`);
  }

  parseOr(): unknown {
    let left = this.parseAnd();
    while (this.matchOp("||")) {
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  parseAnd(): unknown {
    let left = this.parseEq();
    while (this.matchOp("&&")) {
      const right = this.parseEq();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  parseEq(): unknown {
    let left = this.parseRel();
    while (true) {
      if (this.matchOp("==")) {
        const r = this.parseRel();
        left = left === r;
      } else if (this.matchOp("!=")) {
        const r = this.parseRel();
        left = left !== r;
      } else break;
    }
    return left;
  }

  parseRel(): unknown {
    let left = this.parseUnary();
    while (true) {
      if (this.matchOp("<=")) left = Number(left) <= Number(this.parseUnary());
      else if (this.matchOp(">="))
        left = Number(left) >= Number(this.parseUnary());
      else if (this.matchOp("<"))
        left = Number(left) < Number(this.parseUnary());
      else if (this.matchOp(">"))
        left = Number(left) > Number(this.parseUnary());
      else break;
    }
    return left;
  }

  parseUnary(): unknown {
    if (this.matchOp("!")) return !this.parseUnary();
    return this.parsePrimary();
  }

  parsePrimary(): unknown {
    const t = this.consume();
    if (t.t === "num") return t.v;
    if (t.t === "str") return t.v;
    if (t.t === "bool") return t.v;
    if (t.t === "null") return null;
    if (t.t === "ident") {
      if (!(t.v in this.vars)) throw new Error(`unknown identifier: ${t.v}`);
      return this.vars[t.v];
    }
    if (t.t === "op" && t.v === "(") {
      const val = this.parseOr();
      const close = this.consume();
      if (close.t !== "op" || close.v !== ")")
        throw new Error("missing closing paren");
      return val;
    }
    throw new Error(`unexpected token ${JSON.stringify(t)}`);
  }

  private matchOp(op: string): boolean {
    const p = this.peek();
    if (p && p.t === "op" && p.v === op) {
      this.pos++;
      return true;
    }
    return false;
  }
}
