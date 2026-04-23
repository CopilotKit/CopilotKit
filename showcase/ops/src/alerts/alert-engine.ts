import crypto from "node:crypto";
import { ulid } from "ulid";
import Mustache from "mustache";
import type { TypedEventBus } from "../events/event-bus.js";
import type { MetricsRegistry } from "../http/metrics.js";
import type { Renderer } from "../render/renderer.js";
import type { CompiledRule } from "../rules/rule-loader.js";
import type { AlertStateStore } from "../storage/alert-state-store.js";
import { parseDuration, evalSuppress } from "./dsl.js";
import {
  AggregationBucketStore,
  buildCompositeDedupeKey,
  type Bucket,
  type FlushReason,
} from "./aggregation.js";
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

/**
 * HF-A1: dispatchCronAlert previously synthesized `previousState: null` on
 * every cron tick, which broke perKey dedupe templates that reference
 * `{{outcome.previousState}}` (they rendered empty), broke `red_to_green`
 * transition logging (no baseline to compare against), and masked recovery
 * on a truly-first cron tick. The engine reads the status row for the
 * probe's `key` before synthesizing the outcome when a reader is wired.
 * Optional because existing unit tests construct the engine without a PB
 * connection; in production (`orchestrator.ts`) the reader is always
 * provided so cron ticks see the real prior state.
 */
export interface StatusReader {
  getStateByKey(key: string): Promise<State | null>;
}

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
  /** HF-A1 — optional; see StatusReader JSDoc. */
  statusReader?: StatusReader;
  /**
   * Optional Prometheus registry. When supplied the engine increments:
   *  - `alert_matches{rule}` once per rule whose filter matched an event
   *    (after filterMatchesKey, before dedupe/guard/suppress). Operators
   *    read this to see which rules are active regardless of dispatch.
   *  - `alert_sends{target}` per successfully-delivered target in
   *    sendToTargets. Targets that throw do NOT increment.
   * Tests typically omit this; orchestrator.ts always wires it.
   */
  metrics?: MetricsRegistry;
}

export interface AlertEngine {
  start(): void;
  stop(): void;
  reload(rules: CompiledRule[]): void;
}

export function createAlertEngine(deps: AlertEngineDeps): AlertEngine {
  const {
    bus,
    renderer,
    stateStore,
    targets,
    logger,
    now,
    env,
    statusReader,
    metrics,
  } = deps;
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
        // alert_matches: filter passed — this rule evaluated against this
        // event. Incremented BEFORE dedupe/guard/suppress/bootstrap so the
        // counter reflects rule activity, not delivery. Delivery counted via
        // alert_sends inside sendToTargets.
        metrics?.inc("alert_matches", { rule: rule.id });

        // Aggregated rules: ingest only RED-bearing transitions. Per-match
        // dispatch is short-circuited so aggregated rules never fire the
        // normal path. A1: a `red_to_green` recovery is not a "fleet red"
        // signal — ingesting it would fire <!channel> on recoveries. We
        // evaluate the rule's declared triggers via `resolveTriggers` and
        // skip ingest when the triggered set is purely `red_to_green`.
        // `error` transitions also do not ingest (they route through the
        // dispatchOnError path for non-aggregated rules; aggregated rules
        // don't support onError today).
        if (rule.aggregation) {
          if (evt.outcome.transition === "error") continue;
          const t = evt.outcome.transition as Transition;
          const signalFlags = deriveSignalFlags(evt.result.signal);
          const triggered = resolveTriggers(rule, t, signalFlags);
          const hasRedBearing = triggered.some(
            (name) => name !== "red_to_green",
          );
          if (!hasRedBearing) {
            logger.debug("alert-engine.aggregation-skip-recovery", {
              ruleId: rule.id,
              transition: t,
              triggered,
            });
            continue;
          }
          const signalObj = signalAsObject(evt.result.signal);
          aggStore.ingest(rule, signalObj, now().getTime());
          continue;
        }

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
        // an existing green record) or `first` with state=red/degraded (no
        // prior record). Both are false-positives for alerting purposes.
        // HF13-A1: mirror dispatchCronAlert's `red || degraded` fresh-gate here
        // so a first-observation degraded arriving via the status-changed bus
        // is also suppressed inside the bootstrap window. Pre-fix only `red`
        // was gated and a fresh degraded escaped to fire a spurious alert.
        const isFreshRed =
          triggered.includes("green_to_red") ||
          (triggered.includes("first") &&
            (evt.outcome.newState === "red" ||
              evt.outcome.newState === "degraded"));
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
    // alert_matches: cron rule dispatched to this engine — counted as a
    // "match" on the rule.scheduled path (no filter layer; the scheduler
    // already resolved the rule). Keeps the counter symmetric with the
    // status.changed path.
    metrics?.inc("alert_matches", { rule: rule.id });
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
    // A4: dedupe bucket must be stable regardless of the YAML author's
    // ordering of `triggers:`. `triggered` preserves author order so flag
    // emission (trigger.<name> sections) honours the declaration, but for
    // dedupe-key purposes we pick the alpha-first name — reordering the
    // YAML list no longer silently reassigns the dedupe bucket for the
    // same underlying transition.
    const sortedForDedupe = [...triggered].sort();
    const fallbackTrigger = sortedForDedupe[0] ?? evt.outcome.transition;
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
    // A5/A10: prefix fallback dedupe key with `rule.id:` as belt-and-braces
    // against cross-rule collisions. `stateStore.get(rule.id, dedupeKey)`
    // already scopes by rule id, so this is defensive — but it keeps the
    // fallback shape congruent with any future stateStore that flattens
    // the namespace, and it makes grep-debugging alert state rows cheaper.
    return `${rule.id}:${evt.result.key}:${fallbackTrigger}`;
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
    // R24 bucket-a#7: fail-CLOSED on eval error. Spamming Slack during a
    // DSL-eval regression is worse than silently missing an alert window —
    // a silently-dropped alert is diagnosable via the bus event below; a
    // Slack-spam regression pages a human. Also emit `suppress.eval-failed`
    // on the bus so operators see the failure on a dedicated channel (log
    // lines get lost).
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
          // HF13-E2 coord: `probeErrored` is a flat alias for
          // `signal.probeErrored` surfaced by probes that distinguish "probe
          // failed" from "probe ran and found nothing". Rules such as
          // redirect-decommission-monthly widen their suppress expression
          // with `probeErrored != true` so an audit failure is NOT silently
          // suppressed as "no candidates". Must stay in sync with
          // SUPPRESS_VALIDATION_VARS in rule-loader.ts.
          probeErrored: signal["probeErrored"] === true,
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
        const errStr = String(err);
        logger.error("alert-engine.suppress-eval-failed", {
          rule: rule.id,
          when: rule.conditions.suppress.when,
          err: errStr,
        });
        // R24 bucket-a#7: emit structured bus event so operators can route
        // suppress eval regressions to a dedicated channel (log lines alone
        // are easy to miss).
        bus.emit("suppress.eval-failed", {
          ruleId: rule.id,
          expression: rule.conditions.suppress.when,
          error: errStr,
        });
        // Fail-CLOSED: treat an eval error as "suppressed" to avoid a spam
        // regression during DSL-eval bugs. Load-time validation catches the
        // common cases (see rule-loader.ts), so a runtime throw should be
        // rare and is actionable via the bus event above.
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
    const { results, allSucceeded } = await sendToTargets(rule, rendered);
    const anySucceeded = results.some((r) => r.ok);
    if (!anySucceeded) {
      logger.warn("alert-engine.record-skipped", {
        rule: rule.id,
        reason: "all-targets-failed",
      });
      return;
    }
    if (!allSucceeded) {
      // R24 bucket-a#6: any target failed — do NOT advance dedupe at the
      // rule level. Tolerates a duplicate delivery to healthy targets on
      // the next tick in exchange for guaranteed retry to failed targets.
      // Per-target dedupe would be the precise fix but requires extending
      // alert_state's composite key (rule_id, dedupe_key) with target;
      // tracked for follow-up. Minimal diff today: rule-level retry.
      logger.warn("alert-engine.dedupe-held-partial", {
        rule: rule.id,
        failed: results.filter((r) => !r.ok).map((r) => r.kind),
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
    const { results, allSucceeded } = await sendToTargets(rule, rendered);
    const anySucceeded = results.some((r) => r.ok);
    if (!anySucceeded) {
      logger.warn("alert-engine.record-skipped", {
        rule: rule.id,
        reason: "all-targets-failed",
        path: "onError",
      });
      return;
    }
    if (!allSucceeded) {
      logger.warn("alert-engine.dedupe-held-partial", {
        rule: rule.id,
        path: "onError",
        failed: results.filter((r) => !r.ok).map((r) => r.kind),
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
    // B3: aggregated rules are handled via the status.changed ingress path
    // (handleStatusChanged calls `aggStore.ingest`). The cron path would
    // render `rule.template` (often empty for aggregation-only rules) or
    // bypass aggregation entirely. Skip defensively so a rule that ever
    // declares BOTH cron triggers AND aggregation can't double-dispatch.
    if (rule.aggregation) return;
    const probeState = evt.result?.state;
    // Guard: a rule without a top-level template is still valid if it declares
    // `on_error: { template: ... }` — error ticks route to dispatchOnError which
    // renders rule.onError.template, not rule.template. Only early-return when
    // this tick has no template-rendering path available (no top-level template
    // AND won't use the onError branch).
    const willUseOnError = probeState === "error" && !!rule.onError;
    if (!rule.template && !willUseOnError) return;
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
    const fakeResult: ProbeResult<unknown> = evt.result ?? {
      key: `${rule.signal.dimension}:scheduled`,
      state: "green",
      signal: {},
      observedAt: evt.scheduledAt,
    };
    // HF-A1: read the real prior state from PB (via the injected
    // statusReader) so the synthesized outcome carries an accurate
    // `previousState` rather than a fabricated null. Fail open on read
    // error — log at warn so operators notice dedupe semantics degrade,
    // but keep the tick dispatching (a broken status read must not
    // silence alerts). Tests without a wired reader still get null, matching
    // pre-fix behavior.
    let previousState: State | null = null;
    if (statusReader) {
      try {
        previousState = await statusReader.getStateByKey(fakeResult.key);
      } catch (err) {
        logger.warn("alert-engine.cron-status-read-failed", {
          ruleId: rule.id,
          key: fakeResult.key,
          err: String(err),
        });
        previousState = null;
      }
    }
    const outcome: WriteOutcome = {
      previousState,
      // HF-A6: carry the probe's real `"error"` state through instead of
      // fabricating a red. `WriteOutcome.newState` permits `State | "error"`
      // (see types/index.ts). Downstream consumers:
      //   - buildContext: reads via `evt.outcome.newState === "red" |
      //     "degraded"` (HF-A2 isRedTick) — the error bucket intentionally
      //     does NOT satisfy those, because `transition === "error"` routes
      //     cron-error ticks to dispatchOnError (line ~440 below).
      //   - buildDedupeKey: dedupe bucket is derived from triggered[] or
      //     `evt.outcome.transition`, NOT newState, so the error value flows
      //     through without colliding with red dedupe.
      //   - status-writer: does NOT consume this synthesized outcome; its
      //     own error-path preserves the prior State under `carriedState`.
      // Non-error cron ticks unchanged.
      newState: probeState === "error" ? "error" : resolvedState,
      // Use the probe's actual transition semantics on errors: `"error"`
      // (matching handleStatusChanged's onError path). For non-error
      // probes keep "first" — cron ticks are first-observation in the
      // rule's own framing.
      transition: probeState === "error" ? "error" : "first",
      firstFailureAt: signalFirstFailureAt,
      failCount: signalFailCount,
    };
    if (fakeResult.state === "error" && rule.onError) {
      // A1: apply the same `passesGuards` filter as the status.changed
      // onError path. Without this, a rule with `minDeployAgeMin: 10` would
      // see cron-path onError fire inside the deploy-age window while the
      // status.changed onError path correctly suppressed it. `dispatchOnError`
      // internally enforces bootstrap suppression (bootstrapActive()) and
      // rate-limit (shouldSuppress), but guard evaluation is owned here so
      // control-flow order is: guards → bootstrap (inside dispatchOnError)
      // → suppress/rate-limit (inside dispatchOnError) → dispatch. See A9.
      if (!passesGuards(rule, { outcome, result: fakeResult })) return;
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
    // Apply same dedupe + rate-limit gating as status.changed alerts.
    // R24 bucket-a#5: bootstrap gate must mirror handleStatusChanged so
    // signal-derived triggers (set_drifted, set_errored, cancelled_*,
    // set_changed, gate_skipped) are NOT swallowed during the bootstrap
    // window. Those flags represent legitimate invariant-probe reds —
    // bootstrap was only meant to suppress the spurious "first"/no-history
    // cold-start burst, not real drift signals. Suppress only when the
    // triggered list is a bare "first" (no signal-derived companion flags)
    // AND state is red/degraded. Any other trigger path proceeds.
    const isBareFirstRed =
      resolvedState !== "green" &&
      (resolvedState === "red" || resolvedState === "degraded") &&
      triggered.length === 1 &&
      triggered[0] === "first";
    if (isBareFirstRed && bootstrapActive()) {
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
    // Rules declaring only on_error (no top-level template) reach this point
    // on non-error ticks. Nothing to render on the main path — just return.
    // The error branch above returns early via dispatchOnError.
    if (!rule.template) return;
    const rendered = renderer.render(rule.template, ctx);
    const { results, allSucceeded } = await sendToTargets(rule, rendered);
    const anySucceeded = results.some((r) => r.ok);
    if (!anySucceeded) {
      logger.warn("alert-engine.record-skipped", {
        rule: rule.id,
        reason: "all-targets-failed",
        path: "cron",
      });
      return;
    }
    if (!allSucceeded) {
      logger.warn("alert-engine.dedupe-held-partial", {
        rule: rule.id,
        path: "cron",
        failed: results.filter((r) => !r.ok).map((r) => r.kind),
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

  /**
   * Per-target delivery result.
   *
   * R24 bucket-a#6: pre-fix `sendToTargets` returned a single boolean
   * `anySucceeded` which caused rule-level dedupe to advance as soon as
   * any target succeeded — a rotated/broken webhook would silently stop
   * receiving alerts because its target failed but dedupe said "delivered".
   * This structure lets callers inspect per-target outcomes and withhold
   * dedupe advancement whenever any target failed.
   */
  interface TargetSendResult {
    kind: string;
    ok: boolean;
    skipped?: boolean;
    error?: string;
  }
  async function sendToTargets(
    rule: CompiledRule,
    rendered: {
      payload: Record<string, unknown>;
      contentType: "application/json";
    },
  ): Promise<{ results: TargetSendResult[]; allSucceeded: boolean }> {
    const results: TargetSendResult[] = [];
    for (const t of rule.targets) {
      const adapter = targets.get(t.kind);
      if (!adapter) {
        // Missing adapter is a configuration issue, not a delivery failure
        // in the transient sense — but from the dedupe-advancement
        // perspective it is a not-delivered target. Treat as a failure for
        // dedupe purposes so the rule remains eligible to retry once the
        // adapter is wired, mirroring the failed-delivery path.
        logger.warn("alert-engine.no-target-adapter", {
          rule: rule.id,
          kind: t.kind,
        });
        results.push({
          kind: t.kind,
          ok: false,
          skipped: true,
          error: "no-adapter",
        });
        continue;
      }
      try {
        await adapter.send(rendered, t);
        results.push({ kind: t.kind, ok: true });
        // alert_sends: one increment per successfully-delivered target.
        // Failures intentionally skipped (they are visible via
        // alert-engine.target-failed logs and the delivery-failure counter
        // is distinct from send-success semantics).
        metrics?.inc("alert_sends", { target: t.kind });
      } catch (err) {
        // Log per-target failure at warn level with target identifier so
        // operators see WHICH target failed — not the rule-level aggregate.
        // Previously logged at error; warn is appropriate because the
        // caller decides whether to escalate based on per-target outcome.
        logger.warn("alert-engine.target-failed", {
          rule: rule.id,
          kind: t.kind,
          err: String(err),
        });
        results.push({ kind: t.kind, ok: false, error: String(err) });
      }
    }
    const anySucceeded = results.some((r) => r.ok);
    const anyFailed = results.some((r) => !r.ok);
    // `allSucceeded` is the dedupe-advance gate. A rule with zero targets
    // is considered "nothing to fail" — but alerts with no targets are a
    // load-time misconfig we don't defend here (rule-loader schema keeps
    // `targets` non-empty). We require anySucceeded so an all-failed
    // delivery does NOT advance dedupe either — matching the pre-fix
    // "record-skipped" branch semantics.
    return { results, allSucceeded: anySucceeded && !anyFailed };
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
    // HF-A2: isRedTick previously only covered `green_to_red || sustained_red`,
    // silently dropping error, set_drifted, set_errored, first+red, and
    // degraded-first. Templates using `{{#trigger.isRedTick}}` rendered
    // empty for every one of those — which is the entire error surface of
    // the invariant probes (aimock-wiring, pin-drift, image-drift). Rebuild
    // the flag from the authoritative outcome state PLUS the flag set so
    // every legitimately-red observation lights it up. A degraded tick is
    // treated as red-adjacent for alerting purposes (it's an on-call ping,
    // not a "green with caveat").
    const stateIsRed =
      evt.outcome.newState === "red" ||
      evt.outcome.newState === "degraded" ||
      evt.outcome.newState === "error";
    flags.isRedTick =
      flags.green_to_red ||
      flags.sustained_red ||
      flags.set_drifted ||
      flags.set_errored ||
      (flags.first && stateIsRed);
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
    // HF-A3: track the winning escalation's `mention` alongside severity so
    // templates can render `{{escalationMention}}`. The winning escalation
    // is the highest-threshold match (last in ascending-sort order), matching
    // the severity-pick semantics above — keeping the two fields consistent.
    let escalationMention: string | undefined;
    const sortedEscalations = [...rule.conditions.escalations].sort(
      (a, b) => a.whenFailCount - b.whenFailCount,
    );
    for (const esc of sortedEscalations) {
      if (evt.outcome.failCount >= esc.whenFailCount) {
        escalated = true;
        if (esc.severity) severity = esc.severity;
        // Adopt each matching escalation's mention as we pass its threshold.
        // An escalation without an explicit `mention` leaves the last-set
        // value in place — carries the lower tier's mention forward instead
        // of clobbering it with undefined. Operators can still null out a
        // mention at a higher tier by declaring `mention: ""` explicitly.
        if (esc.mention !== undefined) escalationMention = esc.mention;
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
      escalationMention,
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

  /**
   * Composite flush callback invoked by the aggregation store when a bucket
   * either hits `minMatches` or expires. Applies rate_limit + bootstrap gates
   * against `buildCompositeDedupeKey(rule, groupValues)` so successive
   * windows with the same logical group collapse to one dispatch; renders
   * the aggregation template with `{ count, services, firstSignal, lastSignal,
   * groupValues }` context.
   *
   * Failures inside here are logged but must not propagate — a render or
   * dispatch error on one bucket must not kill the engine or block
   * subsequent ingress. The store itself tolerates a throwing onFlush (the
   * bucket is already removed before invocation), so swallowing here is
   * belt-and-braces.
   */
  async function onAggregationFlush(
    bucket: Bucket,
    _reason: FlushReason,
  ): Promise<void | "suppressed"> {
    const rule = rules.find((r) => r.id === bucket.ruleId);
    if (!rule || !rule.aggregation) return;
    const dedupeKey = buildCompositeDedupeKey(rule, bucket.groupValues);
    try {
      // Bootstrap gate — mirrors handleStatusChanged: fresh-boot bursts of
      // matches would otherwise fire a composite during the bootstrap window.
      // A5: return "suppressed" so the store keeps the bucket live; the next
      // ingestion crossing threshold after bootstrap closes can re-fire.
      if (bootstrapActive()) {
        logger.info("alert-engine.bootstrap-suppress", {
          ruleId: rule.id,
          reason: "bootstrap_aggregation",
          dedupeKey,
        });
        return "suppressed";
      }
      // Rate-limit gate against the composite dedupeKey so two consecutive
      // window expiries for the same groupValues collapse to one dispatch
      // when rate_limit.window spans multiple aggregation windows. A5: like
      // bootstrap, return "suppressed" so the bucket stays live — post
      // rate-limit window the next ingestion can deliver.
      if (rule.conditions.rate_limit?.window) {
        const windowMs = parseDuration(rule.conditions.rate_limit.window);
        const last = await stateStore.get(rule.id, dedupeKey);
        if (last?.last_alert_at) {
          const elapsed =
            now().getTime() - new Date(last.last_alert_at).getTime();
          if (elapsed < windowMs) {
            logger.debug("alert-engine.rate-limited", {
              rule: rule.id,
              path: "aggregation",
            });
            return "suppressed";
          }
        }
      }
      const count = bucket.matches.length;
      const services = bucket.matches
        .map((s) => {
          const slug = (s as Record<string, unknown>)["slug"];
          return typeof slug === "string" ? slug : "";
        })
        .filter((s) => s.length > 0)
        .join(", ");
      const firstSignal = bucket.matches[0] ?? {};
      const lastSignal = bucket.matches[bucket.matches.length - 1] ?? {};
      const text = Mustache.render(rule.aggregation.template, {
        count,
        services,
        firstSignal,
        lastSignal,
        groupValues: bucket.groupValues,
      });
      const rendered = {
        payload: { text } as Record<string, unknown>,
        contentType: "application/json" as const,
      };
      const { results, allSucceeded } = await sendToTargets(rule, rendered);
      const anySucceeded = results.some((r) => r.ok);
      if (!anySucceeded) {
        logger.warn("alert-engine.record-skipped", {
          rule: rule.id,
          reason: "all-targets-failed",
          path: "aggregation",
        });
        return;
      }
      if (!allSucceeded) {
        logger.warn("alert-engine.dedupe-held-partial", {
          rule: rule.id,
          path: "aggregation",
          failed: results.filter((r) => !r.ok).map((r) => r.kind),
        });
        return;
      }
      const hash = hashPayload(rendered.payload);
      const preview = JSON.stringify(rendered.payload).slice(0, 500);
      await stateStore.record(rule.id, dedupeKey, {
        at: now().toISOString(),
        hash,
        preview,
      });
    } catch (err) {
      logger.error("alert-engine.aggregation-flush-failed", {
        ruleId: rule.id,
        dedupeKey,
        err: String(err),
      });
    }
  }

  const aggStore = new AggregationBucketStore((bucket, reason) => {
    // A4 / A5: return the promise directly so the store can `await` it
    // inside `drain()` (SIGTERM path) AND observe the "suppressed" sentinel
    // to keep the bucket live when an engine gate short-circuits dispatch.
    // Attach a `.catch` tail for unhandled throws without swallowing the
    // return value.
    return onAggregationFlush(bucket, reason).catch((err) => {
      logger.error("alert-engine.aggregation-flush-unhandled", {
        ruleId: bucket.ruleId,
        err: String(err),
      });
      // Undefined → store treats as a normal (non-suppressed) flush; the
      // bucket will be marked flushedAt and drop on timer expiry.
      return undefined;
    });
  });

  // Register a drain on graceful shutdown so in-flight buckets flush their
  // composites rather than silently vanishing. SIGKILL still loses them by
  // design — the next probe tick rebuilds bucket state naturally.
  //
  // A4: SIGTERM handler awaits drain() so composites actually dispatch
  // before the process exits. `beforeExit` stays as best-effort (Node's
  // beforeExit cannot truly await) — we swallow the promise tail with a
  // .catch so an async flush error on shutdown doesn't crash the process.
  // Guard against repeated registration when the engine is re-created in
  // tests.
  const sigtermHandler = (): void => {
    aggStore.drain().catch((err) =>
      logger.error("alert-engine.drain-failed", {
        err: String(err),
        path: "sigterm",
      }),
    );
  };
  const beforeExit = (): void => {
    aggStore.drain().catch((err) =>
      logger.warn("alert-engine.drain-failed", {
        err: String(err),
        path: "beforeExit",
        hint: "beforeExit cannot actually await — SIGKILL / abrupt exit would drop in-flight buckets",
      }),
    );
  };
  process.once("beforeExit", beforeExit);
  process.once("SIGTERM", sigtermHandler);

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
      // Remove the beforeExit + SIGTERM listeners so repeated engine
      // create/stop cycles in tests don't accumulate listeners and trip
      // Node's MaxListenersExceededWarning. `process.once` would self-remove
      // after the first emit — but tests never reach those signals, so we
      // drop the listeners explicitly here.
      process.removeListener("beforeExit", beforeExit);
      process.removeListener("SIGTERM", sigtermHandler);
      // Drain any in-flight buckets on stop() too, so test runs that create
      // many engines don't leak timers into subsequent tests. A4: fire and
      // forget here — callers that need to await drain must invoke the
      // `drain()` directly on the store (engine deliberately stays a sync
      // stop() for backward-compat with the AlertEngine interface).
      aggStore.drain().catch((err) =>
        logger.warn("alert-engine.drain-failed", {
          err: String(err),
          path: "stop",
        }),
      );
    },
    reload(next) {
      rules = next;
    },
  };
}

// TODO: status-writer.ts has a near-identical `deriveDimensionWithWarn`
// with once-per-key warn logging. Consolidate into a shared util under
// src/types/ or src/util/ — this copy stays lean (no logging) because the
// alert-engine hot path must not re-warn on every match, but the
// key-parsing rules (colon-split, "unknown" fallback) MUST stay in lockstep
// with the writer's version. Kept duplicated for now to avoid tangling
// ownership; fold into a shared module in the next refactor pass.
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
  //
  // HF13-C1: also emit set_errored when the probe itself couldn't run to
  // completion (`signal.probeErrored === true`). aimock-wiring with a
  // malformed `aimockUrl` bypasses per-service iteration and short-circuits
  // with `probeErrored: true` + `erroredPreview` — without this branch the
  // aimock-wiring-drift rule would silently collapse on "config is broken"
  // instead of firing the errored-state branch.
  const erroredArr = Array.isArray(s.errored) ? (s.errored as unknown[]) : null;
  if ((erroredArr && erroredArr.length > 0) || s.probeErrored === true)
    flags.set_errored = true;

  // HF13-E1: gate_skipped — fires when the deploy workflow's lockfile /
  // detect-changes gate blocked the build matrix before any service ran.
  // The probe resolves this payload to state:"green" / failedCount:0, so
  // no state-machine transition (green_to_red / red_to_green) fires and
  // without this flag the rule silently drops the tick. See the
  // deploy-result.yml gate-skipped template branch.
  if (s.gateSkipped === true) flags.gate_skipped = true;

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
