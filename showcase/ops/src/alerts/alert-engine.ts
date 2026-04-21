import crypto from "node:crypto";
import { ulid } from "ulid";
import Mustache from "mustache";
import type { TypedEventBus } from "../events/event-bus.js";
import type { Renderer } from "../render/renderer.js";
import type { CompiledRule } from "../rules/rule-loader.js";
import type { AlertStateStore } from "../storage/alert-state-store.js";
import { parseDuration, evalSuppress } from "./dsl.js";
// Re-export so existing callers (rule-loader, tests) that import from
// alert-engine.js continue to work without touching every import site.
// Fresh modules should import from ./dsl.js directly.
export { parseDuration, evalSuppress } from "./dsl.js";
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

  // Tracks whether we've emitted the "window closed" log; once-only so the
  // operator gets a single line in the log stream at the transition boundary
  // rather than every subsequent check reprinting it.
  let bootstrapWindowClosedLogged = false;
  function bootstrapActive(): boolean {
    const active = now().getTime() - bootTime < bootstrapWindowMs;
    if (!active && !bootstrapWindowClosedLogged && bootstrapWindowMs > 0) {
      bootstrapWindowClosedLogged = true;
      logger.info("alert-engine.bootstrap-window-ended", {
        bootstrapWindowMs,
        bootAt: new Date(bootTime).toISOString(),
      });
    }
    return active;
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
    // For cron-driven rules we forward to dispatchCronAlert, which inspects
    // the probe's result (if any) to derive both the transition AND any
    // signal-derived trigger flags (set_drifted, cancelled_*, etc.). A rule
    // that declares e.g. `set_drifted` must see that flag reflected in its
    // `triggered` array — NOT the synthetic "first" we previously hardcoded.
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
    //
    // Parse-time validation happens at rule-load; a throw here means a
    // runtime-unknown identifier or a var shape the rule didn't anticipate.
    // Fail OPEN on eval error — a broken suppress clause must not silently
    // suppress every matching alert. Log at error level so operators notice.
    if (rule.conditions.suppress) {
      // Null-prototype bag: evalSuppress uses Object.hasOwn for lookups
      // (defence against `toString`/`constructor` typos in rule YAML).
      // Using a null-prototype object here as belt-and-braces so even if
      // a future change swaps hasOwn for `in`, Object.prototype members
      // stay unreachable.
      // Project a small set of flat identifiers from `signal` into the
      // suppress-var bag. The DSL is intentionally flat (no dot-access) so
      // rule authors reference `hasCandidates` rather than
      // `signal.hasCandidates`. Add further projections here only when a
      // rule actually needs them — keep the surface small so load-time
      // validation in rule-loader's SUPPRESS_VALIDATION_VARS stays in sync.
      const signal = signalAsObject(evt.result.signal);
      const vars: Record<string, unknown> = Object.assign(
        Object.create(null) as Record<string, unknown>,
        {
          trigger: triggered[0] ?? transition,
          lastAlertAgeMin: ageMin,
          hasCandidates: signal["hasCandidates"] === true,
        },
      );
      try {
        if (evalSuppress(rule.conditions.suppress.when, vars)) {
          logger.debug("alert-engine.suppressed", {
            rule: rule.id,
            reason: "expression",
          });
          return true;
        }
      } catch (err) {
        logger.error("alert-engine.suppress-eval-failed", {
          rule: rule.id,
          when: rule.conditions.suppress.when,
          err: String(err),
        });
        // Fall through — alert is allowed to fire.
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
      // State-of-record on the synthesized outcome MUST reflect the actual
      // probe state. Pre-fix, error ticks routed through dispatchOnError
      // still carried `newState: "green"` because resolvedState collapses
      // anything-not-red/degraded to green — downstream consumers
      // (templates, dedupe keying, metrics dashboards) saw a green state
      // on an error event. We preserve the probe's real state here and
      // let the rest of the path interpret it correctly; the type allows
      // "green"|"red"|"degraded" only, so for error ticks we fall back to
      // "red" (the closest real State) rather than lying about green.
      newState:
        probeState === "error" ? "red" : resolvedState,
      // Use the probe's actual transition semantics on errors: `"error"`
      // (matching handleStatusChanged's onError path). For non-error
      // probes keep "first" — cron ticks are first-observation in the
      // rule's own framing.
      transition: probeState === "error" ? "error" : "first",
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
    // Resolve triggers from the probe's real signal + the synthesized cron
    // transition ("first"). Rules declaring signal-derived flags like
    // `set_drifted` / `cancelled_*` / `set_changed` will now light up those
    // flags on cron ticks, instead of everyone silently collapsing onto
    // ["first"]. Pure cron-only rules (no string triggers declared, only a
    // cron_only schedule) fall back to ["first"] so the tick still dispatches
    // — that's the whole point of declaring a cron trigger.
    const signalFlags = deriveSignalFlags(fakeResult.signal);
    let triggered = resolveTriggers(rule, "first", signalFlags);
    if (triggered.length === 0) {
      // Two fall-back cases keep previously-working rules firing:
      //  1. Rule explicitly declares `first` as a string trigger (pre-fix
      //     semantics for rules that only want first-observation dispatch).
      //  2. Rule is cron-only — no string triggers, but has a cron schedule.
      //     Those MUST fire on every tick; there's no other mechanism for
      //     them to surface. Dormancy here would silently break weekly
      //     reports and invariant probes.
      const isCronOnly =
        rule.cronTriggers.length > 0 && rule.stringTriggers.length === 0;
      if (rule.stringTriggers.includes("first") || isCronOnly) {
        triggered = ["first"];
      }
    }
    if (triggered.length === 0) {
      // Dormant: declared triggers didn't match this tick. Surface at debug
      // so the same "silent zero" diagnostic used by handleStatusChanged is
      // available here too.
      logger.debug("alert-engine.no-triggers-matched", {
        ruleId: rule.id,
        transition: "first",
        signalFlags,
        declared: rule.stringTriggers,
        path: "cron",
      });
      return;
    }
    // Apply same dedupe + rate-limit gating as status.changed alerts. Bootstrap
    // suppression kicks in for any fresh non-green observation: a cron-driven
    // rule observing `red` OR `degraded` for the first time (transition
    // "first") is indistinguishable from bootstrap noise and must be
    // suppressed. Pre-fix only `resolvedState === "red"` was gated — degraded
    // first-seen state silently fired through the window.
    const isFreshRed =
      resolvedState === "red" || resolvedState === "degraded";
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
    //
    // Escalation evaluation is order-dependent: the last matching escalation
    // in declaration order wins for `severity`. To make the result stable
    // regardless of YAML author ordering, we sort by whenFailCount ascending
    // so higher thresholds override lower ones naturally. Without this,
    // declaring `[{whenFailCount:10,severity:critical}, {whenFailCount:4,severity:error}]`
    // at failCount=10 would yield `error` (last match) instead of the
    // intuitive `critical` (highest matching threshold).
    let escalated = false;
    let severity: Severity = rule.severity;
    const sortedEscalations = [...rule.conditions.escalations].sort(
      (a, b) => a.whenFailCount - b.whenFailCount,
    );
    for (const esc of sortedEscalations) {
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

// TODO(cluster-consolidation): status-writer.ts has a near-identical
// deriveDimensionWithWarn with once-per-key warn logging. Consolidate into
// a shared util under src/types/ or src/util/ once both clusters can touch
// the same file — cluster 2 owns status-writer, cluster 3 owns types/.
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

  // Set-errored: mirrors set_drifted but keys on the `errored` bucket.
  // A pure-errored invariant-probe tick (e.g. aimock-wiring saw N services
  // but couldn't read env vars for them) emits state:"red" with empty
  // `unwired` and non-empty `errored` — neither set_drifted nor
  // red_to_green fires, so the rule silently collapses. set_errored lights
  // up this case so YAML rules can render an "errored services" block.
  const erroredArr = Array.isArray(s.errored) ? (s.errored as unknown[]) : null;
  if (erroredArr && erroredArr.length > 0) flags.set_errored = true;

  return flags;
}

/**
 * Resolve which declared triggers on a rule actually fire for this event.
 * Combines the state-machine transition with signal-derived flags; returns
 * names in the order they match the rule's declaration list.
 *
 * IMPORTANT: the returned order tracks the rule's declaration, NOT a stable
 * dedupe-bucket ordering. `buildDedupeKey` uses `triggered[0]` — the first
 * matched trigger — so reordering YAML `triggers:` will change the dedupe
 * bucket for the same underlying transition. Keep the order intentional.
 *
 * Prototype-walk guard: the inner `signalFlags[declared]` lookup is gated
 * on `Object.hasOwn` so a YAML rule that declares `toString` / `constructor`
 * / `hasOwnProperty` / `__proto__` as a trigger cannot silently resolve
 * against `Object.prototype`. Without the guard, `signalFlags.toString`
 * returns a function reference — truthy — and fires spurious alerts.
 */
function resolveTriggers(
  rule: CompiledRule,
  transition: Transition,
  signalFlags: Partial<Record<keyof TriggerFlags, boolean>>,
): string[] {
  const matched: string[] = [];
  const flagsRec = signalFlags as Record<string, unknown>;
  for (const declared of rule.stringTriggers) {
    if (declared === transition) {
      matched.push(declared);
      continue;
    }
    // Own-property check prevents walking into Object.prototype for names
    // like `toString`, `constructor`, `hasOwnProperty`, `__proto__`.
    if (Object.hasOwn(flagsRec, declared) && flagsRec[declared] === true) {
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
