import { describe, it, expect, beforeEach } from "vitest";
import {
  createAlertEngine,
  parseDuration,
  evalSuppress,
} from "./alert-engine.js";
import { createEventBus } from "../events/event-bus.js";
import { createRenderer } from "../render/renderer.js";
import { logger } from "../logger.js";
import type { AlertStateStore } from "../storage/alert-state-store.js";
import type {
  AlertStateRecord,
  ProbeResult,
  State,
  Target,
  Transition,
} from "../types/index.js";
import type { CompiledRule } from "../rules/rule-loader.js";

function memStore(): AlertStateStore {
  const m = new Map<string, AlertStateRecord>();
  return {
    async get(rule, key) {
      return m.get(`${rule}|${key}`) ?? null;
    },
    async record(rule, key, f) {
      m.set(`${rule}|${key}`, {
        rule_id: rule,
        dedupe_key: key,
        last_alert_at: f.at,
        last_alert_hash: f.hash,
        payload_preview: f.preview,
      });
    },
    async getSet() {
      return { hash: null, at: null };
    },
    async putSet() {},
  };
}

function captureTarget(): { target: Target; sent: unknown[] } {
  const sent: unknown[] = [];
  const target: Target = {
    kind: "slack_webhook",
    async send(rendered) {
      sent.push(rendered);
    },
  };
  return { target, sent };
}

function baseRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    id: "smoke-red-tick",
    name: "smoke",
    owner: "@oss",
    severity: "warn",
    signal: { dimension: "smoke" },
    stringTriggers: ["green_to_red", "sustained_red", "red_to_green"],
    cronTriggers: [],
    conditions: { guards: [], escalations: [] },
    targets: [{ kind: "slack_webhook", webhook: "oss_alerts" }],
    template: {
      text: "{{#trigger.green_to_red}}RED {{signal.slug}}{{/trigger.green_to_red}}{{#trigger.sustained_red}}RED again{{/trigger.sustained_red}}{{#trigger.red_to_green}}OK{{/trigger.red_to_green}}",
    },
    actions: [],
    ...overrides,
  };
}

function probeRes(
  state: "green" | "red" | "degraded" | "error",
  slug = "mastra",
): ProbeResult<unknown> {
  return {
    key: `smoke:${slug}`,
    state,
    signal: { slug },
    observedAt: "2026-04-20T00:00:00Z",
  };
}

describe("alert-engine", () => {
  let bus: ReturnType<typeof createEventBus>;
  let renderer: ReturnType<typeof createRenderer>;
  let store: AlertStateStore;
  let tgt: ReturnType<typeof captureTarget>;

  beforeEach(() => {
    bus = createEventBus();
    renderer = createRenderer();
    store = memStore();
    tgt = captureTarget();
  });

  function engine(
    overrides: Partial<Parameters<typeof createAlertEngine>[0]> = {},
  ): ReturnType<typeof createAlertEngine> {
    const tMap = new Map([["slack_webhook", tgt.target]]);
    return createAlertEngine({
      bus,
      renderer,
      stateStore: store,
      targets: tMap,
      logger,
      now: () => new Date("2026-04-20T01:00:00Z"),
      env: { dashboardUrl: "https://d", repo: "r/r" },
      bootstrapWindowMs: 0,
      ...overrides,
    });
  }

  it("dispatches green_to_red to slack target", async () => {
    const e = engine();
    e.start();
    e.reload([baseRule()]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "2026-04-20T00:00:00Z",
      },
      result: probeRes("red"),
    });
    await Promise.resolve();
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
  });

  it("does NOT dispatch unrelated transition", async () => {
    const e = engine();
    e.start();
    e.reload([baseRule({ stringTriggers: ["green_to_red"] })]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "red",
        newState: "red",
        transition: "sustained_red",
        failCount: 2,
        firstFailureAt: "x",
      },
      result: probeRes("red"),
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(0);
  });

  it("rate-limits within window", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        conditions: {
          guards: [],
          escalations: [],
          rate_limit: { window: "15m" },
        },
      }),
    ]);
    const outcome = {
      previousState: "red" as const,
      newState: "red" as const,
      transition: "sustained_red" as const,
      failCount: 2,
      firstFailureAt: "x",
    };
    bus.emit("status.changed", { outcome, result: probeRes("red") });
    await new Promise((r) => setImmediate(r));
    bus.emit("status.changed", { outcome, result: probeRes("red") });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
  });

  it("suppress-expression blocks sustained_red but allows red_to_green", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        conditions: {
          guards: [],
          escalations: [],
          suppress: {
            when: 'trigger == "sustained_red" && lastAlertAgeMin < 15',
          },
        },
      }),
    ]);
    // Seed alert_state so lastAlertAgeMin is small. Dedupe key shape is
    // `${rule.id}:${evt.result.key}:${fallbackTrigger}` (A5/A10).
    await store.record(
      "smoke-red-tick",
      "smoke-red-tick:smoke:mastra:sustained_red",
      {
        at: "2026-04-20T00:55:00Z",
        hash: "h",
        preview: "",
      },
    );
    bus.emit("status.changed", {
      outcome: {
        previousState: "red",
        newState: "red",
        transition: "sustained_red",
        failCount: 2,
        firstFailureAt: "x",
      },
      result: probeRes("red"),
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(0);

    bus.emit("status.changed", {
      outcome: {
        previousState: "red",
        newState: "green",
        transition: "red_to_green",
        failCount: 0,
        firstFailureAt: null,
      },
      result: probeRes("green"),
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
  });

  it("suppresses cron tick when signal.hasCandidates is false (flat alias)", async () => {
    // Regression: cluster 6 wired redirect-decommission-monthly.yml to
    // suppress on `hasCandidates != true`. alert-engine must inject
    // signal.hasCandidates into the suppress-var bag under the flat name
    // `hasCandidates` — otherwise evalSuppress throws "unknown identifier"
    // at dispatch time and the alert fires anyway (fail-open).
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        id: "redirect-decommission-monthly",
        signal: { dimension: "redirect_decommission" },
        stringTriggers: [],
        cronTriggers: [{ schedule: "0 9 1 * *" }],
        conditions: {
          guards: [],
          escalations: [],
          suppress: { when: "hasCandidates != true" },
        },
        template: { text: "RAN" },
      }),
    ]);
    bus.emit("rule.scheduled", {
      ruleId: "redirect-decommission-monthly",
      scheduledAt: "2026-04-20T09:00:00Z",
      result: {
        key: "redirect_decommission:monthly",
        state: "green",
        signal: { hasCandidates: false, body: "" },
        observedAt: "2026-04-20T09:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(0);
  });

  it("allows cron tick when signal.hasCandidates is true (flat alias)", async () => {
    // Counter-test for the suppression above: when hasCandidates is true,
    // the `hasCandidates != true` suppress expression evaluates false and
    // the alert is allowed through.
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        id: "redirect-decommission-monthly",
        signal: { dimension: "redirect_decommission" },
        stringTriggers: [],
        cronTriggers: [{ schedule: "0 9 1 * *" }],
        conditions: {
          guards: [],
          escalations: [],
          suppress: { when: "hasCandidates != true" },
        },
        template: { text: "RAN" },
      }),
    ]);
    bus.emit("rule.scheduled", {
      ruleId: "redirect-decommission-monthly",
      scheduledAt: "2026-04-20T09:00:00Z",
      result: {
        key: "redirect_decommission:monthly",
        state: "green",
        signal: { hasCandidates: true, body: "report" },
        observedAt: "2026-04-20T09:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
  });

  it("bootstrap window suppresses green_to_red", async () => {
    const e = engine({ bootstrapWindowMs: 15 * 60_000 });
    e.start();
    e.reload([baseRule()]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "2026-04-20T00:00:00Z",
      },
      result: probeRes("red"),
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(0);
  });

  it("escalation at whenFailCount bumps severity in context", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        conditions: {
          guards: [],
          escalations: [
            { whenFailCount: 4, mention: "!channel", severity: "critical" },
          ],
        },
        template: {
          text: "{{#escalated}}!CH {{rule.severity}}{{/escalated}}{{^escalated}}norm{{/escalated}}",
        },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "red",
        newState: "red",
        transition: "sustained_red",
        failCount: 4,
        firstFailureAt: "x",
      },
      result: probeRes("red"),
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
    const payload = (tgt.sent[0] as { payload: { text: string } }).payload.text;
    expect(payload).toBe("!CH critical");
  });

  it("on_error rule fires on transition===error", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        onError: { template: { text: "ERR: {{signal.errorDesc}}" } },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "red",
        newState: "red",
        transition: "error",
        failCount: 1,
        firstFailureAt: "x",
      },
      result: {
        key: "smoke:mastra",
        state: "error",
        signal: { errorDesc: "boom" },
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
    expect((tgt.sent[0] as { payload: { text: string } }).payload.text).toBe(
      "ERR: boom",
    );
  });

  it("fires cancelled_midmatrix from signal flags on a green transition", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        id: "deploy-result",
        signal: { dimension: "deploy", filter: { key: "overall" } },
        stringTriggers: ["green_to_red", "red_to_green", "cancelled_midmatrix"],
        template: {
          text: "{{#trigger.cancelled_midmatrix}}MID{{/trigger.cancelled_midmatrix}}",
        },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "green",
        transition: "sustained_green",
        failCount: 0,
        firstFailureAt: null,
      },
      result: {
        key: "deploy:overall",
        state: "green",
        signal: { cancelledMidMatrix: true },
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
    expect((tgt.sent[0] as { payload: { text: string } }).payload.text).toBe(
      "MID",
    );
  });

  it("fires set_changed when signal.triggered is non-empty", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        id: "image-drift",
        signal: { dimension: "image_drift" },
        stringTriggers: ["set_changed"],
        template: { text: "{{signal.triggeredCount}} drifted" },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "2026-04-20T00:00:00Z",
      },
      result: {
        key: "image_drift:global",
        state: "red",
        signal: {
          staleServices: ["a"],
          triggered: ["a"],
          rebuildFailures: [],
          triggeredCount: 1,
          rebuildNoun: "rebuild",
        },
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
    expect((tgt.sent[0] as { payload: { text: string } }).payload.text).toBe(
      "1 drifted",
    );
  });

  it("fires set_drifted when signal.unwired is non-empty", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        id: "aimock-wiring-drift",
        signal: { dimension: "aimock_wiring" },
        stringTriggers: ["set_drifted"],
        template: { text: "{{signal.unwiredCount}} unwired" },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "2026-04-20T00:00:00Z",
      },
      result: {
        key: "aimock_wiring:global",
        state: "red",
        signal: {
          unwired: ["showcase-quickstart"],
          wired: [],
          unwiredCount: 1,
          wiredCount: 0,
          unwiredNoun: "service",
        },
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
    expect((tgt.sent[0] as { payload: { text: string } }).payload.text).toBe(
      "1 unwired",
    );
  });

  it("set_drifted does NOT fire when signal.unwired is empty", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        id: "aimock-wiring-drift",
        signal: { dimension: "aimock_wiring" },
        // Declare BOTH green_to_red (the transition) and set_drifted (the
        // flag). resolveTriggers returns only flags actually set — since
        // unwired is empty, set_drifted is not set, so only green_to_red
        // would fire. If the template renders empty string, Mustache would
        // still dispatch. Use a template that ONLY renders inside
        // {{#trigger.set_drifted}}…{{/trigger.set_drifted}} so an empty
        // payload proves set_drifted did NOT fire.
        stringTriggers: ["green_to_red", "set_drifted"],
        template: {
          text: "{{#trigger.set_drifted}}drift{{/trigger.set_drifted}}",
        },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "2026-04-20T00:00:00Z",
      },
      result: {
        key: "aimock_wiring:global",
        state: "red",
        signal: {
          unwired: [],
          wired: ["a"],
          unwiredCount: 0,
          wiredCount: 1,
          unwiredNoun: "services",
        },
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    // green_to_red DOES fire so a message is sent; however set_drifted does
    // NOT fire (because signal.unwired is empty), so the rendered payload
    // must be empty — this is what we're actually testing.
    expect(tgt.sent).toHaveLength(1);
    expect((tgt.sent[0] as { payload: { text: string } }).payload.text).toBe(
      "",
    );
  });

  it("filter.slug matches glob pattern", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        signal: { dimension: "smoke", filter: { slug: "mastra-*" } },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "x",
      },
      result: probeRes("red", "mastra-foo"),
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
  });
});

describe("alert-engine (additional behaviors)", () => {
  let bus: ReturnType<typeof createEventBus>;
  let renderer: ReturnType<typeof createRenderer>;
  let store: AlertStateStore;
  let tgt: ReturnType<typeof captureTarget>;

  beforeEach(() => {
    bus = createEventBus();
    renderer = createRenderer();
    store = memStore();
    tgt = captureTarget();
  });

  function engine(
    overrides: Partial<Parameters<typeof createAlertEngine>[0]> = {},
  ): ReturnType<typeof createAlertEngine> {
    const tMap = new Map([["slack_webhook", tgt.target]]);
    return createAlertEngine({
      bus,
      renderer,
      stateStore: store,
      targets: tMap,
      logger,
      now: () => new Date("2026-04-20T01:00:00Z"),
      env: { dashboardUrl: "https://d", repo: "r/r" },
      bootstrapWindowMs: 0,
      ...overrides,
    });
  }

  it("cron alert rate-limits on repeated fires (dedupe applied)", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        id: "weekly-cron",
        signal: { dimension: "pin_drift" },
        cronTriggers: [{ schedule: "0 10 * * 1" }],
        stringTriggers: [],
        template: { text: "weekly {{signal.actualCount}}" },
        conditions: {
          guards: [],
          escalations: [],
          rate_limit: { window: "1h" },
        },
      }),
    ]);
    const fire = (): void => {
      bus.emit("rule.scheduled", {
        ruleId: "weekly-cron",
        scheduledAt: "2026-04-20T10:00:00Z",
        result: {
          key: "pin_drift:weekly",
          state: "green",
          signal: { actualCount: 3 },
          observedAt: "2026-04-20T10:00:00Z",
        },
      });
    };
    fire();
    await new Promise((r) => setImmediate(r));
    fire();
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
  });

  it("cron alert defaults missing result.state to green (no undefined newState)", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        id: "weekly-cron",
        signal: { dimension: "pin_drift" },
        // Cron-only rule: empty stringTriggers + a cron schedule. This is the
        // shape real cron rules take (rule-loader emits both arrays this way).
        stringTriggers: [],
        cronTriggers: [{ schedule: "0 10 * * 1" }],
        template: { text: "ran" },
        conditions: { guards: [], escalations: [] },
      }),
    ]);
    bus.emit("rule.scheduled", {
      ruleId: "weekly-cron",
      scheduledAt: "2026-04-20T10:00:00Z",
      // No `result`
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
  });

  it("onError alert rate-limits (dedupe applied)", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        onError: { template: { text: "ERR" } },
        conditions: {
          guards: [],
          escalations: [],
          rate_limit: { window: "1h" },
        },
      }),
    ]);
    const fire = (): void => {
      bus.emit("status.changed", {
        outcome: {
          previousState: "red",
          newState: "red",
          transition: "error",
          failCount: 1,
          firstFailureAt: "x",
        },
        result: {
          key: "smoke:mastra",
          state: "error",
          signal: { errorDesc: "boom" },
          observedAt: "2026-04-20T00:00:00Z",
        },
      });
    };
    fire();
    await new Promise((r) => setImmediate(r));
    fire();
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
  });

  it("per-rule try/catch isolates one rule's throw from siblings", async () => {
    const e = engine();
    e.start();
    const badRenderer = createRenderer();
    // Monkey-patch renderer so one rule throws, but other rule still sends.
    const tMap = new Map([["slack_webhook", tgt.target]]);
    const engineWithBadRender = createAlertEngine({
      bus,
      renderer: {
        render(tmpl, ctx) {
          if ((ctx.rule.id as string) === "bad") throw new Error("boom");
          return badRenderer.render(tmpl, ctx);
        },
      },
      stateStore: store,
      targets: tMap,
      logger,
      now: () => new Date("2026-04-20T01:00:00Z"),
      env: { dashboardUrl: "https://d", repo: "r/r" },
      bootstrapWindowMs: 0,
    });
    engineWithBadRender.start();
    engineWithBadRender.reload([
      baseRule({ id: "bad" }),
      baseRule({ id: "good" }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "x",
      },
      result: probeRes("red"),
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
    engineWithBadRender.stop();
  });

  it("filter.dimension compares to event's actual dimension (not rule's own)", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        id: "deploy-overall-only",
        signal: {
          dimension: "deploy",
          filter: { dimension: "deploy", key: "overall" },
        },
        stringTriggers: ["green_to_red"],
        template: { text: "dep" },
      }),
    ]);
    // Event is smoke:mastra — filter.dimension=deploy must reject.
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "x",
      },
      result: probeRes("red"),
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(0);
  });

  it("rate_limit.perKey renders template for dedupe key", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        conditions: {
          guards: [],
          escalations: [],
          rate_limit: {
            // `triggerName` is the string form; `trigger` is the TriggerFlags
            // object exposed to alert templates. perKey uses the string.
            perKey: "{{signal.slug}}:{{triggerName}}",
            window: "15m",
          },
        },
      }),
    ]);
    // Same slug + same trigger on two events must dedupe.
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "x",
      },
      result: probeRes("red", "mastra"),
    });
    await new Promise((r) => setImmediate(r));
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "x",
      },
      result: probeRes("red", "mastra"),
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
    // Different slug, same trigger — separate dedupe key → should fire.
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "x",
      },
      result: probeRes("red", "otherslug"),
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(2);
  });

  it("perKey with {{triggerName}} produces distinct dedupe keys per transition", async () => {
    // Regression: previously the default smoke-red-tick perKey used
    // `{{trigger}}` (the flags OBJECT), which stringified to "[object Object]"
    // for every transition — collapsing green_to_red + sustained_red into the
    // same dedupe bucket and suppressing every follow-up tick. With
    // `{{triggerName}}`, each transition gets its own bucket so a green_to_red
    // followed by a sustained_red must both fire.
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        stringTriggers: ["green_to_red", "sustained_red"],
        conditions: {
          guards: [],
          escalations: [],
          rate_limit: {
            perKey: "{{signal.slug}}:{{triggerName}}",
            window: "15m",
          },
        },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "x",
      },
      result: probeRes("red", "mastra"),
    });
    await new Promise((r) => setImmediate(r));
    bus.emit("status.changed", {
      outcome: {
        previousState: "red",
        newState: "red",
        transition: "sustained_red",
        failCount: 2,
        firstFailureAt: "x",
      },
      result: probeRes("red", "mastra"),
    });
    await new Promise((r) => setImmediate(r));
    // Two distinct dedupe buckets → both dispatches fire.
    expect(tgt.sent).toHaveLength(2);
  });

  it("cron alert resolves set_drifted from signal (not hardcoded 'first')", async () => {
    // Regression guard for the critical bug where dispatchCronAlert hardcoded
    // `triggered:["first"]`, causing rules that declared `set_drifted` (e.g.
    // aimock-wiring-drift) to render their templates with trigger.first=true
    // and trigger.set_drifted=false — the drift block silently collapsed.
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        id: "aimock-wiring-drift",
        signal: { dimension: "aimock_wiring" },
        // Rule declares `set_drifted` only — NOT `first`. Under the old
        // dispatchCronAlert, this never fired (hardcoded "first" didn't
        // match). Under the fix, resolveTriggers sees signal.unwired and
        // lights up set_drifted.
        stringTriggers: ["set_drifted"],
        cronTriggers: [{ schedule: "0 * * * *" }],
        template: {
          text: "{{#trigger.set_drifted}}DRIFT {{signal.unwiredCount}}{{/trigger.set_drifted}}",
        },
        conditions: { guards: [], escalations: [] },
      }),
    ]);
    bus.emit("rule.scheduled", {
      ruleId: "aimock-wiring-drift",
      scheduledAt: "2026-04-20T10:00:00Z",
      result: {
        key: "aimock_wiring:check",
        state: "red",
        signal: {
          unwired: ["svc-a", "svc-b"],
          unwiredCount: 2,
        },
        observedAt: "2026-04-20T10:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
    expect((tgt.sent[0] as { payload: { text: string } }).payload.text).toBe(
      "DRIFT 2",
    );
  });

  it("resolveTriggers refuses prototype-chain trigger names", async () => {
    // Guard against a YAML author declaring `toString` / `hasOwnProperty` /
    // `constructor` as a trigger name. Without the Object.hasOwn guard, the
    // inner lookup walks Object.prototype, returns a function reference
    // (truthy), and fires a spurious alert on every cron tick.
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        id: "bogus-proto-trigger",
        signal: { dimension: "smoke" },
        // `toString` is a real Object.prototype method — if the lookup walked
        // the prototype chain, signalFlags.toString would be truthy and the
        // rule would fire. Our guard treats it as an unknown trigger name.
        stringTriggers: ["toString" as never],
        cronTriggers: [],
        template: { text: "should-never-fire" },
        conditions: { guards: [], escalations: [] },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "green",
        transition: "sustained_green",
        failCount: 0,
        firstFailureAt: null,
      },
      result: {
        key: "smoke:mastra",
        state: "green",
        signal: {},
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(0);
  });

  it("parseDuration rejects zero/negative numeric specs", async () => {
    const { parseDuration } = await import("./dsl.js");
    expect(() => parseDuration(0)).toThrow(/must be > 0/);
    expect(() => parseDuration(-1)).toThrow(/must be > 0/);
    expect(() => parseDuration("0s")).toThrow(/must be > 0/);
    // Positive values still work.
    expect(parseDuration(1_000)).toBe(1_000);
    expect(parseDuration("15m")).toBe(15 * 60_000);
  });

  it("escalation severity = highest matching whenFailCount regardless of YAML order", async () => {
    // Regression guard: previously the last matching escalation in
    // declaration order won. Authors who declared
    //   [{whenFailCount:10,severity:critical}, {whenFailCount:4,severity:error}]
    // at failCount=10 got `error` (last match) instead of `critical`
    // (highest matching threshold). The sort-ascending fix makes the
    // highest threshold naturally win.
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        id: "escalation-order",
        signal: { dimension: "smoke" },
        stringTriggers: ["sustained_red"],
        template: { text: "{{rule.severity}}" },
        conditions: {
          guards: [],
          // Declared in REVERSE ascending order on purpose: under the old
          // "last match wins" rule this would yield "error". Under the fix
          // (sort ascending, higher overrides), we get "critical".
          escalations: [
            { whenFailCount: 10, severity: "critical" },
            { whenFailCount: 4, severity: "error" },
          ],
        },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "red",
        newState: "red",
        transition: "sustained_red",
        failCount: 10,
        firstFailureAt: "x",
      },
      result: probeRes("red"),
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
    expect((tgt.sent[0] as { payload: { text: string } }).payload.text).toBe(
      "critical",
    );
  });

  it("cron alert threads real probe signal.* into the template", async () => {
    // dispatchCronAlert must prefer evt.result (a real probe outcome) over the
    // synthetic fallback. signal.* fields from the probe must show up in the
    // rendered template context — otherwise the weekly/monthly report rules
    // render empty bodies.
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        id: "weekly-cron",
        signal: { dimension: "pin_drift" },
        cronTriggers: [{ schedule: "0 10 * * 1" }],
        stringTriggers: [],
        template: {
          text: "expected={{signal.expectedCount}} actual={{signal.actualCount}} drift={{signal.driftedCount}}",
        },
        conditions: { guards: [], escalations: [] },
      }),
    ]);
    bus.emit("rule.scheduled", {
      ruleId: "weekly-cron",
      scheduledAt: "2026-04-20T10:00:00Z",
      result: {
        key: "pin_drift:weekly",
        state: "red",
        signal: {
          expectedCount: 17,
          actualCount: 14,
          driftedCount: 3,
        },
        observedAt: "2026-04-20T10:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
    expect((tgt.sent[0] as { payload: { text: string } }).payload.text).toBe(
      "expected=17 actual=14 drift=3",
    );
  });

  it("minDeployAgeMin guard suppresses when deploy is too young", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        conditions: {
          guards: [{ minDeployAgeMin: 20 }],
          escalations: [],
        },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "x",
      },
      result: {
        key: "smoke:mastra",
        state: "red",
        // deployedAt 5 minutes before `now` (01:00:00) — under 20min threshold.
        signal: { slug: "mastra", deployedAt: "2026-04-20T00:55:00Z" },
        observedAt: "2026-04-20T00:55:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(0);
  });

  it("minDeployAgeMin guard allows when deploy is old enough", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        conditions: {
          guards: [{ minDeployAgeMin: 20 }],
          escalations: [],
        },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "x",
      },
      result: {
        key: "smoke:mastra",
        state: "red",
        signal: { slug: "mastra", deployedAt: "2026-04-19T00:00:00Z" },
        observedAt: "2026-04-20T00:55:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
  });

  it("minDeployAgeMin guard fails open when deployedAt is absent", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        conditions: {
          guards: [{ minDeployAgeMin: 20 }],
          escalations: [],
        },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "x",
      },
      result: probeRes("red"),
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
  });

  it("escalation fires at or past threshold (>= semantics)", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        conditions: {
          guards: [],
          escalations: [
            { whenFailCount: 4, mention: "!channel", severity: "critical" },
          ],
          rate_limit: undefined,
        },
        template: {
          text: "{{#escalated}}E{{rule.severity}}{{/escalated}}{{^escalated}}n{{/escalated}}",
        },
      }),
    ]);
    for (const fc of [4, 5, 10]) {
      bus.emit("status.changed", {
        outcome: {
          previousState: "red",
          newState: "red",
          transition: "sustained_red",
          failCount: fc,
          firstFailureAt: "x",
        },
        result: probeRes("red"),
      });
      await new Promise((r) => setImmediate(r));
    }
    expect(tgt.sent).toHaveLength(3);
    for (const s of tgt.sent) {
      expect((s as { payload: { text: string } }).payload.text).toBe(
        "Ecritical",
      );
    }
  });

  it("bootstrap suppresses `first` with state=red too", async () => {
    const e = engine({ bootstrapWindowMs: 15 * 60_000 });
    e.start();
    e.reload([baseRule({ stringTriggers: ["first"] })]);
    bus.emit("status.changed", {
      outcome: {
        previousState: null,
        newState: "red",
        transition: "first",
        failCount: 1,
        firstFailureAt: "2026-04-20T00:00:00Z",
      },
      result: probeRes("red"),
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(0);
  });

  // HF13-A1: mirror dispatchCronAlert's `red || degraded` fresh-gate onto
  // handleStatusChanged. Pre-fix the status.changed path only gated `red`,
  // so a first-observation degraded via the live bus escaped bootstrap
  // suppression and fired a spurious alert.
  it("HF13-A1: bootstrap suppresses `first` with state=degraded too", async () => {
    const e = engine({ bootstrapWindowMs: 15 * 60_000 });
    e.start();
    e.reload([baseRule({ stringTriggers: ["first"] })]);
    bus.emit("status.changed", {
      outcome: {
        previousState: null,
        newState: "degraded",
        transition: "first",
        failCount: 1,
        firstFailureAt: "2026-04-20T00:00:00Z",
      },
      result: probeRes("degraded"),
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(0);
  });

  // HF13-E2 coord: `probeErrored` must be populated in the suppress var bag
  // so rules widening `hasCandidates != true` with `probeErrored != true`
  // fire when the probe itself failed (audit error), and still suppress when
  // the probe succeeded and found nothing.
  it("HF13-E2: suppress exposes `probeErrored` flat identifier", async () => {
    const e = engine();
    e.start();
    // Rule fires on `first` and only suppresses when BOTH
    // `hasCandidates != true` AND `probeErrored != true`.
    e.reload([
      baseRule({
        stringTriggers: ["first"],
        conditions: {
          guards: [],
          escalations: [],
          suppress: {
            when: "hasCandidates != true && probeErrored != true",
          },
        },
      }),
    ]);
    // 1) probe succeeded and found nothing → suppressed (old behavior).
    bus.emit("status.changed", {
      outcome: {
        previousState: null,
        newState: "green",
        transition: "first",
        failCount: 0,
        firstFailureAt: null,
      },
      result: {
        key: "smoke:a",
        state: "green",
        signal: { slug: "a", hasCandidates: false, probeErrored: false },
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(0);
    // 2) probe failed (probeErrored=true) → NOT suppressed.
    bus.emit("status.changed", {
      outcome: {
        previousState: null,
        newState: "green",
        transition: "first",
        failCount: 0,
        firstFailureAt: null,
      },
      result: {
        key: "smoke:b",
        state: "green",
        signal: { slug: "b", hasCandidates: false, probeErrored: true },
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
  });

  // HF13-C1: deriveSignalFlags must emit `set_errored` when `probeErrored`
  // is true, even if the `errored` array is empty. A probe that short-circuits
  // on malformed config emits `probeErrored: true` + `erroredPreview` without
  // iterating services — the rule's set_errored branch must still light up.
  it("HF13-C1: set_errored fires on signal.probeErrored=true with empty errored[]", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        stringTriggers: ["set_errored"],
        template: { text: "{{#trigger.set_errored}}ERR{{/trigger.set_errored}}" },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "2026-04-20T00:00:00Z",
      },
      result: {
        key: "smoke:mastra",
        state: "red",
        signal: {
          slug: "mastra",
          probeErrored: true,
          erroredPreview: "aimockUrl parse failed: http://",
        },
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
    expect((tgt.sent[0] as { payload: { text: string } }).payload.text).toBe(
      "ERR",
    );
  });

  // HF13-E1: deriveSignalFlags must emit `gate_skipped` when
  // `signal.gateSkipped === true`. The showcase_deploy.yml notify-ops step
  // posts a `gateSkipped: true` payload when the lockfile/detect-changes
  // gate blocks the build matrix before any service deploys; the probe
  // resolves that to state:"green" / failedCount:0, so no state-machine
  // transition fires. Without this derived flag the tick is silently
  // dropped and operators never see the gate. Red-green verification:
  // reverting any of the three source changes (schema enum, TriggerFlags,
  // deriveSignalFlags emit) makes this assertion fail.
  it("HF13-E1: gate_skipped fires on signal.gateSkipped=true with green state", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        id: "deploy-result",
        signal: { dimension: "deploy", filter: { key: "overall" } },
        stringTriggers: ["green_to_red", "red_to_green", "gate_skipped"],
        template: {
          text: "{{#trigger.gate_skipped}}GATED{{/trigger.gate_skipped}}",
        },
      }),
    ]);
    // Gate-skipped payload resolves to state:"green", no transition that
    // the rule's state triggers match. Only the signal-derived flag path
    // can cause dispatch.
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "green",
        transition: "first",
        failCount: 0,
        firstFailureAt: null,
      },
      result: {
        key: "deploy:overall",
        state: "green",
        signal: {
          gateSkipped: true,
          failedCount: 0,
          succeededCount: 0,
          totalCount: 0,
        },
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
    expect((tgt.sent[0] as { payload: { text: string } }).payload.text).toBe(
      "GATED",
    );
  });

  // HF13-E1: neighboring assertion — a deploy-result payload WITHOUT
  // gateSkipped must not inadvertently light up gate_skipped (prototype
  // walk / bag leak regression guard).
  it("HF13-E1: gate_skipped does NOT fire when signal.gateSkipped absent", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        id: "deploy-result",
        signal: { dimension: "deploy", filter: { key: "overall" } },
        stringTriggers: ["gate_skipped"],
        template: {
          text: "{{#trigger.gate_skipped}}GATED{{/trigger.gate_skipped}}",
        },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "green",
        transition: "first",
        failCount: 0,
        firstFailureAt: null,
      },
      result: {
        key: "deploy:overall",
        state: "green",
        signal: { failedCount: 0, succeededCount: 3, totalCount: 3 },
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(0);
  });

  it("buildContext threads runUrl / runId / jobUrl from signal to event.*", async () => {
    const e = engine();
    e.start();
    e.reload([
      baseRule({
        signal: { dimension: "deploy", filter: { key: "overall" } },
        stringTriggers: ["green_to_red"],
        template: { text: "run={{{event.runUrl}}} id={{event.runId}}" },
      }),
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "x",
      },
      result: {
        key: "deploy:overall",
        state: "red",
        signal: { runId: "99", runUrl: "https://ci/99" },
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(tgt.sent).toHaveLength(1);
    expect((tgt.sent[0] as { payload: { text: string } }).payload.text).toBe(
      "run=https://ci/99 id=99",
    );
  });
});

describe("parseDuration", () => {
  it("parses 15m", () => expect(parseDuration("15m")).toBe(15 * 60_000));
  it("parses 5s", () => expect(parseDuration("5s")).toBe(5_000));
  it("parses 2h", () => expect(parseDuration("2h")).toBe(7_200_000));
  it("passes numbers through", () => expect(parseDuration(500)).toBe(500));
  it("throws on garbage", () => expect(() => parseDuration("nope")).toThrow());
});

describe("evalSuppress", () => {
  it("handles equality + inequality", () => {
    expect(
      evalSuppress('trigger == "sustained_red"', { trigger: "sustained_red" }),
    ).toBe(true);
    expect(
      evalSuppress('trigger == "sustained_red"', { trigger: "red_to_green" }),
    ).toBe(false);
  });
  it("handles compound conditions", () => {
    expect(
      evalSuppress('trigger == "sustained_red" && lastAlertAgeMin < 15', {
        trigger: "sustained_red",
        lastAlertAgeMin: 5,
      }),
    ).toBe(true);
    expect(
      evalSuppress('trigger == "sustained_red" && lastAlertAgeMin < 15', {
        trigger: "sustained_red",
        lastAlertAgeMin: 30,
      }),
    ).toBe(false);
  });
  it("rejects function calls and member access (no JS escape hatch)", () => {
    expect(() => evalSuppress("process.exit(1)", {})).toThrow();
    expect(() =>
      evalSuppress('constructor("return 1")()', {
        constructor: 1,
      } as Record<string, unknown>),
    ).toThrow();
    expect(() => evalSuppress("foo.bar", { foo: { bar: 1 } })).toThrow();
    expect(() => evalSuppress("foo[0]", { foo: [1] })).toThrow();
  });
  it("rejects unknown identifiers", () => {
    expect(() => evalSuppress("totally_unknown == 1", {})).toThrow();
  });
  it("supports parens, negation, and mixed operators", () => {
    expect(
      evalSuppress('!(a < 5) && (b >= 10 || c == "x")', {
        a: 6,
        b: 11,
        c: "y",
      }),
    ).toBe(true);
  });
  // F1.4: evalSuppress must use Object.hasOwn — not `in` — so YAML typos
  // like `when: "toString"` don't walk Object.prototype and resolve to a
  // function reference (truthy), silently suppressing every alert.
  it("rejects Object.prototype identifiers via Object.hasOwn", () => {
    expect(() => evalSuppress("toString == 1", {})).toThrow(
      /unknown identifier/,
    );
    expect(() => evalSuppress("hasOwnProperty == 1", {})).toThrow(
      /unknown identifier/,
    );
    expect(() => evalSuppress("constructor == 1", {})).toThrow(
      /unknown identifier/,
    );
  });
});

// F1.6: isRedTick is a synthesized flag on buildContext's trigger object —
// derived from green_to_red OR sustained_red. Without a direct assertion, a
// refactor could drop the OR and silently empty every red-tick rule.
describe("alert-engine isRedTick flag (F1.6)", () => {
  // These use the same fixtures as the main suite. Re-importing inside the
  // describe so the test is self-contained and easy to grep for.
  // Re-use helpers from the module scope by re-declaring local copies.
  async function runAndAssertRedTick(
    transition: "green_to_red" | "sustained_red" | "sustained_green",
    expected: boolean,
  ): Promise<void> {
    const bus = createEventBus();
    const renderer = createRenderer();
    const store = memStore();
    const sent: unknown[] = [];
    const target: Target = {
      kind: "slack_webhook",
      async send(r) {
        sent.push(r);
      },
    };
    const tMap = new Map([["slack_webhook", target]]);
    const e = createAlertEngine({
      bus,
      renderer,
      stateStore: store,
      targets: tMap,
      logger,
      now: () => new Date("2026-04-20T01:00:00Z"),
      env: { dashboardUrl: "https://d", repo: "r/r" },
      bootstrapWindowMs: 0,
    });
    e.start();
    e.reload([
      {
        id: "isredtick-check",
        name: "x",
        owner: "@oss",
        severity: "warn",
        signal: { dimension: "smoke" },
        stringTriggers: [transition],
        cronTriggers: [],
        conditions: { guards: [], escalations: [] },
        targets: [{ kind: "slack_webhook", webhook: "w" }],
        template: {
          // Template emits "RED" iff trigger.isRedTick is truthy, else "NOT".
          text: "{{#trigger.isRedTick}}RED{{/trigger.isRedTick}}{{^trigger.isRedTick}}NOT{{/trigger.isRedTick}}",
        },
        actions: [],
      },
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: transition === "green_to_red" ? "green" : "red",
        newState: transition === "sustained_green" ? "green" : "red",
        transition,
        failCount: 1,
        firstFailureAt: "2026-04-20T00:00:00Z",
      },
      result: {
        key: "smoke:slug",
        state: transition === "sustained_green" ? "green" : "red",
        signal: { slug: "slug" },
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(1);
    const text = (sent[0] as { payload: { text: string } }).payload.text;
    expect(text).toBe(expected ? "RED" : "NOT");
    e.stop();
  }

  it("trigger.isRedTick is TRUE on green_to_red", async () => {
    await runAndAssertRedTick("green_to_red", true);
  });

  it("trigger.isRedTick is TRUE on sustained_red", async () => {
    await runAndAssertRedTick("sustained_red", true);
  });

  it("trigger.isRedTick is FALSE on sustained_green", async () => {
    await runAndAssertRedTick("sustained_green", false);
  });
});

// F1.7: every string in StringTriggerEnum must have a matching key on
// emptyTriggerFlags(). Otherwise a newly-declared trigger is recognized at
// rule-load but silently ignored at render (Mustache section evaluates an
// absent key as falsy). Catch the drift at test time.
describe("alert-engine StringTriggerEnum ↔ emptyTriggerFlags invariant (F1.7)", () => {
  it("every declared trigger name is represented in emptyTriggerFlags", async () => {
    const { StringTriggerEnum } = await import("../rules/schema.js");
    const { emptyTriggerFlags } = await import("../types/index.js");
    const flags = emptyTriggerFlags() as unknown as Record<string, unknown>;
    for (const t of StringTriggerEnum.options) {
      expect(Object.hasOwn(flags, t), `missing flag for trigger '${t}'`).toBe(
        true,
      );
    }
  });
});

// F1.2/F1.3: dispatchCronAlert must treat `degraded` AND `red` as fresh-red
// states (bootstrap suppression), and must NOT lie about `newState: "green"`
// on error outcomes.
describe("alert-engine dispatchCronAlert fresh-red + error state (F1.2/F1.3)", () => {
  it("bootstrap suppresses cron `degraded` ticks (F1.2)", async () => {
    const bus = createEventBus();
    const renderer = createRenderer();
    const store = memStore();
    const sent: unknown[] = [];
    const target: Target = {
      kind: "slack_webhook",
      async send(r) {
        sent.push(r);
      },
    };
    const tMap = new Map([["slack_webhook", target]]);
    const e = createAlertEngine({
      bus,
      renderer,
      stateStore: store,
      targets: tMap,
      logger,
      now: () => new Date("2026-04-20T00:01:00Z"),
      env: { dashboardUrl: "https://d", repo: "r/r" },
      bootstrapWindowMs: 15 * 60_000,
    });
    e.start();
    e.reload([
      {
        id: "cron-degraded",
        name: "x",
        owner: "@oss",
        severity: "warn",
        signal: { dimension: "pin_drift" },
        stringTriggers: [],
        cronTriggers: [{ schedule: "0 10 * * 1" }],
        conditions: { guards: [], escalations: [] },
        targets: [{ kind: "slack_webhook", webhook: "w" }],
        template: { text: "RAN" },
        actions: [],
      },
    ]);
    // Degraded cron tick inside bootstrap window should be suppressed.
    bus.emit("rule.scheduled", {
      ruleId: "cron-degraded",
      scheduledAt: "2026-04-20T00:01:00Z",
      result: {
        key: "pin_drift:weekly",
        state: "degraded",
        signal: {},
        observedAt: "2026-04-20T00:01:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(0);
    e.stop();
  });

  it("cron `error` tick preserves error transition + routes to onError (F1.3)", async () => {
    const bus = createEventBus();
    const renderer = createRenderer();
    const store = memStore();
    const sent: unknown[] = [];
    const target: Target = {
      kind: "slack_webhook",
      async send(r) {
        sent.push(r);
      },
    };
    const tMap = new Map([["slack_webhook", target]]);
    const e = createAlertEngine({
      bus,
      renderer,
      stateStore: store,
      targets: tMap,
      logger,
      now: () => new Date("2026-04-20T01:00:00Z"),
      env: { dashboardUrl: "https://d", repo: "r/r" },
      bootstrapWindowMs: 0,
    });
    e.start();
    e.reload([
      {
        id: "cron-errored",
        name: "x",
        owner: "@oss",
        severity: "warn",
        signal: { dimension: "pin_drift" },
        stringTriggers: [],
        cronTriggers: [{ schedule: "0 10 * * 1" }],
        conditions: { guards: [], escalations: [] },
        targets: [{ kind: "slack_webhook", webhook: "w" }],
        template: { text: "main" },
        // onError template is distinct so we can prove the router hit the
        // error branch (rather than the green-collapsing branch pre-fix).
        onError: { template: { text: "ERR: {{signal.errorDesc}}" } },
        actions: [],
      },
    ]);
    bus.emit("rule.scheduled", {
      ruleId: "cron-errored",
      scheduledAt: "2026-04-20T10:00:00Z",
      result: {
        key: "pin_drift:weekly",
        state: "error",
        signal: { errorDesc: "GHCR 500" },
        observedAt: "2026-04-20T10:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    // Pre-fix: routed through the main template (newState was synthesized
    // as "green", skipping the error branch). Post-fix: routed via onError.
    expect(sent).toHaveLength(1);
    const text = (sent[0] as { payload: { text: string } }).payload.text;
    expect(text).toBe("ERR: GHCR 500");
    e.stop();
  });
});

// F4.3: set_errored flag mirrors set_drifted but keys on `signal.errored`.
describe("alert-engine set_errored (F4.3)", () => {
  it("fires set_errored when signal.errored is non-empty", async () => {
    const bus = createEventBus();
    const renderer = createRenderer();
    const store = memStore();
    const sent: unknown[] = [];
    const target: Target = {
      kind: "slack_webhook",
      async send(r) {
        sent.push(r);
      },
    };
    const tMap = new Map([["slack_webhook", target]]);
    const e = createAlertEngine({
      bus,
      renderer,
      stateStore: store,
      targets: tMap,
      logger,
      now: () => new Date("2026-04-20T01:00:00Z"),
      env: { dashboardUrl: "https://d", repo: "r/r" },
      bootstrapWindowMs: 0,
    });
    e.start();
    e.reload([
      {
        id: "aimock-wiring-errored",
        name: "x",
        owner: "@oss",
        severity: "warn",
        signal: { dimension: "aimock_wiring" },
        stringTriggers: ["set_errored"],
        cronTriggers: [],
        conditions: { guards: [], escalations: [] },
        targets: [{ kind: "slack_webhook", webhook: "w" }],
        template: {
          text: "{{#trigger.set_errored}}ERR {{signal.erroredCount}}{{/trigger.set_errored}}",
        },
        actions: [],
      },
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "2026-04-20T00:00:00Z",
      },
      result: {
        key: "aimock_wiring:global",
        state: "red",
        signal: {
          errored: ["svc-a"],
          erroredCount: 1,
        },
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(1);
    expect((sent[0] as { payload: { text: string } }).payload.text).toBe(
      "ERR 1",
    );
    e.stop();
  });
});

// R7 Cluster A — A1, A4, A5, A9 regressions.
describe("alert-engine R7 (A1/A4/A5/A9)", () => {
  function makeEngine(
    overrides: { now?: () => Date; bootstrapWindowMs?: number } = {},
  ) {
    const bus = createEventBus();
    const renderer = createRenderer();
    const store = memStore();
    const sent: unknown[] = [];
    const target: Target = {
      kind: "slack_webhook",
      async send(r) {
        sent.push(r);
      },
    };
    const tMap = new Map([["slack_webhook", target]]);
    const e = createAlertEngine({
      bus,
      renderer,
      stateStore: store,
      targets: tMap,
      logger,
      now: overrides.now ?? (() => new Date("2026-04-20T02:00:00Z")),
      env: { dashboardUrl: "https://d", repo: "r/r" },
      bootstrapWindowMs: overrides.bootstrapWindowMs ?? 0,
    });
    return { bus, e, sent, store };
  }

  it("A1: cron `error` tick suppressed when minDeployAgeMin guard fails", async () => {
    // Pre-fix: dispatchCronAlert → dispatchOnError branch skipped
    // passesGuards. A rule with minDeployAgeMin fired on cron-path error
    // inside the deploy-age window even though status.changed's onError
    // path correctly suppressed. This test pins the fix: cron onError
    // must respect minDeployAgeMin.
    const now = () => new Date("2026-04-20T02:00:00Z");
    const { bus, e, sent } = makeEngine({ now, bootstrapWindowMs: 0 });
    e.start();
    e.reload([
      {
        id: "cron-err-guard",
        name: "x",
        owner: "@oss",
        severity: "warn",
        signal: { dimension: "pin_drift" },
        stringTriggers: [],
        cronTriggers: [{ schedule: "0 10 * * 1" }],
        // Deploy 5 minutes before now, guard demands 10. Must suppress.
        conditions: { guards: [{ minDeployAgeMin: 10 }], escalations: [] },
        targets: [{ kind: "slack_webhook", webhook: "w" }],
        template: { text: "main" },
        onError: { template: { text: "ERR" } },
        actions: [],
      },
    ]);
    bus.emit("rule.scheduled", {
      ruleId: "cron-err-guard",
      scheduledAt: "2026-04-20T02:00:00Z",
      result: {
        key: "pin_drift:weekly",
        state: "error",
        // 5 minutes old — well inside the 10min guard window.
        signal: { deployedAt: "2026-04-20T01:55:00Z", errorDesc: "boom" },
        observedAt: "2026-04-20T02:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(0);
    e.stop();
  });

  it("A1: cron `error` tick dispatches when minDeployAgeMin guard passes", async () => {
    const now = () => new Date("2026-04-20T02:00:00Z");
    const { bus, e, sent } = makeEngine({ now, bootstrapWindowMs: 0 });
    e.start();
    e.reload([
      {
        id: "cron-err-guard-ok",
        name: "x",
        owner: "@oss",
        severity: "warn",
        signal: { dimension: "pin_drift" },
        stringTriggers: [],
        cronTriggers: [{ schedule: "0 10 * * 1" }],
        conditions: { guards: [{ minDeployAgeMin: 10 }], escalations: [] },
        targets: [{ kind: "slack_webhook", webhook: "w" }],
        template: { text: "main" },
        onError: { template: { text: "ERR" } },
        actions: [],
      },
    ]);
    bus.emit("rule.scheduled", {
      ruleId: "cron-err-guard-ok",
      scheduledAt: "2026-04-20T02:00:00Z",
      result: {
        key: "pin_drift:weekly",
        state: "error",
        // 20 minutes old — past the 10min threshold.
        signal: { deployedAt: "2026-04-20T01:40:00Z", errorDesc: "boom" },
        observedAt: "2026-04-20T02:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(1);
    expect((sent[0] as { payload: { text: string } }).payload.text).toBe(
      "ERR",
    );
    e.stop();
  });

  it("A5/A10: dedupe key is prefixed with rule.id", async () => {
    // Two rules listening to the same event key must get distinct dedupe
    // rows even under a stateStore namespace flattening. Seed state under
    // the NEW prefixed shape and assert the rate-limit fires correctly.
    const now = () => new Date("2026-04-20T02:00:00Z");
    const { bus, e, sent, store } = makeEngine({ now, bootstrapWindowMs: 0 });
    e.start();
    const rule: CompiledRule = baseRule({
      id: "rule-alpha",
      conditions: {
        guards: [],
        escalations: [],
        rate_limit: { window: "15m" },
      },
    });
    e.reload([rule]);
    // Seed at the new dedupe-key shape (rule-id prefixed).
    await store.record(
      "rule-alpha",
      "rule-alpha:smoke:mastra:green_to_red",
      {
        at: "2026-04-20T01:55:00Z", // 5 minutes ago — inside the 15m window.
        hash: "h",
        preview: "",
      },
    );
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "2026-04-20T01:55:00Z",
      },
      result: probeRes("red"),
    });
    await new Promise((r) => setImmediate(r));
    // Rate-limited because the seed matches the rule-id-prefixed key.
    expect(sent).toHaveLength(0);
    e.stop();
  });

  it("A4: dedupe bucket is stable regardless of YAML `triggers:` order", async () => {
    // Two rules declaring the same trigger set in different YAML order
    // must share the same dedupe bucket. Pre-fix: `triggered[0]` was
    // author-ordered, so `[green_to_red, sustained_red]` and
    // `[sustained_red, green_to_red]` produced different buckets.
    const now = () => new Date("2026-04-20T02:00:00Z");
    const { bus, e, sent, store } = makeEngine({ now, bootstrapWindowMs: 0 });
    e.start();
    // Rule declares triggers [red_to_green, green_to_red]. A transition
    // that fires green_to_red would previously dedupe-key on green_to_red
    // (the first match) — pre-fix dedupe was author-ordered, not alpha.
    // Post-fix: alpha-sorted, so `green_to_red` is the bucket regardless.
    const rule: CompiledRule = baseRule({
      id: "rule-reorder",
      stringTriggers: ["red_to_green", "green_to_red", "sustained_red"],
      conditions: {
        guards: [],
        escalations: [],
        rate_limit: { window: "15m" },
      },
    });
    e.reload([rule]);
    // Seed the alpha-first key (green_to_red precedes sustained_red alpha).
    await store.record(
      "rule-reorder",
      "rule-reorder:smoke:mastra:green_to_red",
      {
        at: "2026-04-20T01:55:00Z", // 5m ago, inside window.
        hash: "h",
        preview: "",
      },
    );
    bus.emit("status.changed", {
      outcome: {
        previousState: "green",
        newState: "red",
        transition: "green_to_red",
        failCount: 1,
        firstFailureAt: "2026-04-20T01:55:00Z",
      },
      result: probeRes("red"),
    });
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(0);
    e.stop();
  });

  it("A9: cron error + bootstrap + guard + suppress interact in the correct order", async () => {
    // Clarifying test for the control-flow subtlety. The order is:
    //   1. dispatchCronAlert sees state==="error" → passesGuards check
    //   2. passesGuards fails (deploy too young) → return, NO dispatch
    // So even if bootstrap window is closed, even if suppress would
    // permit, a failing guard alone is sufficient to suppress.
    const now = () => new Date("2026-04-20T02:00:00Z");
    const { bus, e, sent } = makeEngine({
      now,
      // Bootstrap window wide open (so we test guard, not bootstrap).
      bootstrapWindowMs: 0,
    });
    e.start();
    e.reload([
      {
        id: "cron-order",
        name: "x",
        owner: "@oss",
        severity: "warn",
        signal: { dimension: "pin_drift" },
        stringTriggers: [],
        cronTriggers: [{ schedule: "0 10 * * 1" }],
        conditions: {
          guards: [{ minDeployAgeMin: 10 }],
          escalations: [],
          // Permissive suppress — never blocks.
          suppress: { when: 'trigger == "never_matches"' },
        },
        targets: [{ kind: "slack_webhook", webhook: "w" }],
        template: { text: "main" },
        onError: { template: { text: "ERR" } },
        actions: [],
      },
    ]);
    bus.emit("rule.scheduled", {
      ruleId: "cron-order",
      scheduledAt: "2026-04-20T02:00:00Z",
      result: {
        key: "pin_drift:weekly",
        state: "error",
        signal: { deployedAt: "2026-04-20T01:55:00Z", errorDesc: "x" },
        observedAt: "2026-04-20T02:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    // Guard blocks before suppress even gets to run.
    expect(sent).toHaveLength(0);
    e.stop();
  });
});

// HF-A1: dispatchCronAlert threads the real `previousState` from the PB
// status row into the synthesized WriteOutcome so perKey templates (and
// any future downstream consumer) see an accurate baseline rather than
// the pre-fix hardcoded `null`.
describe("alert-engine dispatchCronAlert previousState threading (HF-A1)", () => {
  it("reads prior state via statusReader and threads it through perKey template", async () => {
    const bus = createEventBus();
    const renderer = createRenderer();
    const store = memStore();
    const sent: unknown[] = [];
    const target: Target = {
      kind: "slack_webhook",
      async send(r) {
        sent.push(r);
      },
    };
    const tMap = new Map([["slack_webhook", target]]);
    const getCalls: string[] = [];
    const e = createAlertEngine({
      bus,
      renderer,
      stateStore: store,
      targets: tMap,
      logger,
      now: () => new Date("2026-04-20T01:00:00Z"),
      env: { dashboardUrl: "https://d", repo: "r/r" },
      bootstrapWindowMs: 0,
      statusReader: {
        async getStateByKey(key) {
          getCalls.push(key);
          return "red";
        },
      },
    });
    e.start();
    e.reload([
      {
        id: "cron-prev-state",
        name: "x",
        owner: "@oss",
        severity: "warn",
        signal: { dimension: "pin_drift" },
        stringTriggers: ["first"],
        cronTriggers: [{ schedule: "0 10 * * 1" }],
        // perKey template references outcome.previousState so dedupe-key
        // generation reads the real prior state — that's where the wire is
        // observable without adding new context surface.
        conditions: {
          guards: [],
          escalations: [],
          rate_limit: {
            perKey:
              "{{rule.id}}:{{#signal}}{{slug}}{{/signal}}:prev={{outcome.previousState}}",
          },
        },
        targets: [{ kind: "slack_webhook", webhook: "w" }],
        template: { text: "prev={{outcome.previousState}}" },
        actions: [],
      } as unknown as CompiledRule,
    ]);
    bus.emit("rule.scheduled", {
      ruleId: "cron-prev-state",
      scheduledAt: "2026-04-20T10:00:00Z",
      result: {
        key: "pin_drift:weekly",
        state: "red",
        signal: { slug: "weekly" },
        observedAt: "2026-04-20T10:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(1);
    // Reader must have been consulted with the probe's actual key.
    expect(getCalls).toEqual(["pin_drift:weekly"]);
    e.stop();
  });

  it("logs warn and falls back to null when statusReader throws", async () => {
    const bus = createEventBus();
    const renderer = createRenderer();
    const store = memStore();
    const sent: unknown[] = [];
    const target: Target = {
      kind: "slack_webhook",
      async send(r) {
        sent.push(r);
      },
    };
    const tMap = new Map([["slack_webhook", target]]);
    const warnCalls: Array<{ msg: string; meta?: Record<string, unknown> }> =
      [];
    const captureLogger = {
      ...logger,
      warn(msg: string, meta?: Record<string, unknown>) {
        warnCalls.push({ msg, meta });
      },
    };
    const e = createAlertEngine({
      bus,
      renderer,
      stateStore: store,
      targets: tMap,
      logger: captureLogger,
      now: () => new Date("2026-04-20T01:00:00Z"),
      env: { dashboardUrl: "https://d", repo: "r/r" },
      bootstrapWindowMs: 0,
      statusReader: {
        async getStateByKey() {
          throw new Error("pb-read-boom");
        },
      },
    });
    e.start();
    e.reload([
      {
        id: "cron-fallback",
        name: "x",
        owner: "@oss",
        severity: "warn",
        signal: { dimension: "pin_drift" },
        stringTriggers: ["first"],
        cronTriggers: [{ schedule: "0 10 * * 1" }],
        conditions: { guards: [], escalations: [] },
        targets: [{ kind: "slack_webhook", webhook: "w" }],
        template: { text: "tick" },
        actions: [],
      } as unknown as CompiledRule,
    ]);
    bus.emit("rule.scheduled", {
      ruleId: "cron-fallback",
      scheduledAt: "2026-04-20T10:00:00Z",
      result: {
        key: "pin_drift:weekly",
        state: "red",
        signal: {},
        observedAt: "2026-04-20T10:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    // Fail-open: alert still fires on PB read failure.
    expect(sent).toHaveLength(1);
    // Warn log must carry the cron-status-read-failed tag so operators can
    // grep for dedupe-semantics degradation.
    expect(
      warnCalls.some((c) => c.msg === "alert-engine.cron-status-read-failed"),
    ).toBe(true);
    e.stop();
  });
});

// HF-A2: isRedTick now covers green_to_red, sustained_red, set_drifted,
// set_errored, and first+red/degraded/error. Pre-fix only the first two
// lit up, so templates using `{{#trigger.isRedTick}}` silently swallowed
// the entire invariant-probe red surface.
describe("alert-engine trigger.isRedTick coverage (HF-A2)", () => {
  const cases: Array<{
    label: string;
    declared: string[];
    transition: Transition;
    newState: State | "error";
    signal?: Record<string, unknown>;
  }> = [
    {
      label: "green_to_red",
      declared: ["green_to_red"],
      transition: "green_to_red",
      newState: "red",
    },
    {
      label: "sustained_red",
      declared: ["sustained_red"],
      transition: "sustained_red",
      newState: "red",
    },
    {
      label: "first+red",
      declared: ["first"],
      transition: "first",
      newState: "red",
    },
    {
      label: "first+degraded",
      declared: ["first"],
      transition: "first",
      newState: "degraded",
    },
    {
      label: "set_drifted",
      declared: ["set_drifted"],
      transition: "sustained_red",
      newState: "red",
      signal: { unwired: ["svc-a"] },
    },
    {
      label: "set_errored",
      declared: ["set_errored"],
      transition: "sustained_red",
      newState: "red",
      signal: { errored: ["svc-a"] },
    },
  ];
  for (const c of cases) {
    it(`isRedTick === true for ${c.label}`, async () => {
      const bus = createEventBus();
      const renderer = createRenderer();
      const store = memStore();
      const sent: unknown[] = [];
      const target: Target = {
        kind: "slack_webhook",
        async send(r) {
          sent.push(r);
        },
      };
      const tMap = new Map([["slack_webhook", target]]);
      const e = createAlertEngine({
        bus,
        renderer,
        stateStore: store,
        targets: tMap,
        logger,
        now: () => new Date("2026-04-20T01:00:00Z"),
        env: { dashboardUrl: "https://d", repo: "r/r" },
        bootstrapWindowMs: 0,
      });
      e.start();
      e.reload([
        {
          id: `isred-${c.label}`,
          name: c.label,
          owner: "@oss",
          severity: "warn",
          signal: { dimension: "smoke" },
          stringTriggers: c.declared,
          cronTriggers: [],
          conditions: { guards: [], escalations: [] },
          targets: [{ kind: "slack_webhook", webhook: "w" }],
          template: {
            text: "{{#trigger.isRedTick}}RED{{/trigger.isRedTick}}{{^trigger.isRedTick}}NO{{/trigger.isRedTick}}",
          },
          actions: [],
        } as unknown as CompiledRule,
      ]);
      bus.emit("status.changed", {
        outcome: {
          previousState:
            c.transition === "green_to_red" ? "green" : "red",
          newState: c.newState as State,
          transition: c.transition,
          failCount: 1,
          firstFailureAt: "2026-04-20T00:00:00Z",
        },
        result: {
          key: "smoke:x",
          state: c.newState === "error" ? "red" : (c.newState as State),
          signal: c.signal ?? {},
          observedAt: "2026-04-20T00:00:00Z",
        },
      });
      await new Promise((r) => setImmediate(r));
      expect(sent).toHaveLength(1);
      expect((sent[0] as { payload: { text: string } }).payload.text).toBe(
        "RED",
      );
      e.stop();
    });
  }
});

// HF-A3: winning escalation's `mention` is threaded into
// `{{escalationMention}}` on TemplateContext. Pre-fix the field didn't
// exist — templates had no way to reference the oncall mention declared on
// the escalation entry, so YAML authors copy-pasted the mention into every
// template by hand.
describe("alert-engine escalation mention threading (HF-A3)", () => {
  it("renders {{escalationMention}} at the winning escalation", async () => {
    const bus = createEventBus();
    const renderer = createRenderer();
    const store = memStore();
    const sent: unknown[] = [];
    const target: Target = {
      kind: "slack_webhook",
      async send(r) {
        sent.push(r);
      },
    };
    const tMap = new Map([["slack_webhook", target]]);
    const e = createAlertEngine({
      bus,
      renderer,
      stateStore: store,
      targets: tMap,
      logger,
      now: () => new Date("2026-04-20T01:00:00Z"),
      env: { dashboardUrl: "https://d", repo: "r/r" },
      bootstrapWindowMs: 0,
    });
    e.start();
    e.reload([
      {
        id: "escal-mention",
        name: "x",
        owner: "@oss",
        severity: "warn",
        signal: { dimension: "smoke" },
        stringTriggers: ["sustained_red"],
        cronTriggers: [],
        conditions: {
          guards: [],
          escalations: [
            { whenFailCount: 4, mention: "@oncall", severity: "error" },
            { whenFailCount: 10, mention: "@pager", severity: "critical" },
          ],
        },
        targets: [{ kind: "slack_webhook", webhook: "w" }],
        template: { text: "ping {{escalationMention}} sev={{rule.severity}}" },
        actions: [],
      } as unknown as CompiledRule,
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "red",
        newState: "red",
        transition: "sustained_red",
        failCount: 4,
        firstFailureAt: "2026-04-20T00:00:00Z",
      },
      result: {
        key: "smoke:x",
        state: "red",
        signal: {},
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(1);
    const text = (sent[0] as { payload: { text: string } }).payload.text;
    expect(text).toBe("ping @oncall sev=error");
    e.stop();
  });

  it("renders empty {{escalationMention}} when no escalation matches", async () => {
    const bus = createEventBus();
    const renderer = createRenderer();
    const store = memStore();
    const sent: unknown[] = [];
    const target: Target = {
      kind: "slack_webhook",
      async send(r) {
        sent.push(r);
      },
    };
    const tMap = new Map([["slack_webhook", target]]);
    const e = createAlertEngine({
      bus,
      renderer,
      stateStore: store,
      targets: tMap,
      logger,
      now: () => new Date("2026-04-20T01:00:00Z"),
      env: { dashboardUrl: "https://d", repo: "r/r" },
      bootstrapWindowMs: 0,
    });
    e.start();
    e.reload([
      {
        id: "escal-no-match",
        name: "x",
        owner: "@oss",
        severity: "warn",
        signal: { dimension: "smoke" },
        stringTriggers: ["sustained_red"],
        cronTriggers: [],
        conditions: {
          guards: [],
          escalations: [
            { whenFailCount: 10, mention: "@pager", severity: "critical" },
          ],
        },
        targets: [{ kind: "slack_webhook", webhook: "w" }],
        template: { text: "m=[{{escalationMention}}]" },
        actions: [],
      } as unknown as CompiledRule,
    ]);
    bus.emit("status.changed", {
      outcome: {
        previousState: "red",
        newState: "red",
        transition: "sustained_red",
        failCount: 2,
        firstFailureAt: "2026-04-20T00:00:00Z",
      },
      result: {
        key: "smoke:x",
        state: "red",
        signal: {},
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(1);
    const text = (sent[0] as { payload: { text: string } }).payload.text;
    expect(text).toBe("m=[]");
    e.stop();
  });
});

// HF-A4: when a filter pipeline throws, the renderer must propagate the
// error out rather than silently substituting a `[filter-error]` string.
// Dispatcher's try/catch then skips dedupe so the next tick retries.
describe("alert-engine renderer filter failure (HF-A4)", () => {
  it("filter throw → renderer throws → no dedupe recorded", async () => {
    const bus = createEventBus();
    const renderer = createRenderer();
    const store = memStore();
    const sent: unknown[] = [];
    const target: Target = {
      kind: "slack_webhook",
      async send(r) {
        sent.push(r);
      },
    };
    const tMap = new Map([["slack_webhook", target]]);
    const e = createAlertEngine({
      bus,
      renderer,
      stateStore: store,
      targets: tMap,
      logger,
      now: () => new Date("2026-04-20T01:00:00Z"),
      env: { dashboardUrl: "https://d", repo: "r/r" },
      bootstrapWindowMs: 0,
    });
    e.start();
    e.reload([
      {
        id: "filter-throws",
        name: "x",
        owner: "@oss",
        severity: "warn",
        signal: { dimension: "smoke" },
        stringTriggers: ["sustained_red"],
        cronTriggers: [],
        conditions: { guards: [], escalations: [] },
        targets: [{ kind: "slack_webhook", webhook: "w" }],
        // signal.boom has a throwing toString — `stripAnsi(String(...))`
        // throws inside applyPipeline. Renderer MUST propagate; dispatcher
        // catches and skips dedupe.
        template: {
          text: "x {{ signal.boom | stripAnsi }}",
        },
        actions: [],
      } as unknown as CompiledRule,
    ]);
    const throwingBoom: unknown = {
      toString() {
        throw new Error("boom-toString");
      },
    };
    bus.emit("status.changed", {
      outcome: {
        previousState: "red",
        newState: "red",
        transition: "sustained_red",
        failCount: 1,
        firstFailureAt: "2026-04-20T00:00:00Z",
      },
      result: {
        key: "smoke:x",
        state: "red",
        signal: { boom: throwingBoom },
        observedAt: "2026-04-20T00:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    // Nothing delivered (renderer threw before reaching the target).
    expect(sent).toHaveLength(0);
    // Dedupe row must NOT be present — next tick retries.
    const record = await store.get(
      "filter-throws",
      "filter-throws:smoke:x:sustained_red",
    );
    expect(record).toBeNull();
    e.stop();
  });
});

// HF-A6: synthesized cron outcome carries the probe's real `"error"` state
// rather than fabricating `"red"`. Verifies newState is preserved through
// to dispatchOnError (the onError template sees it via buildContext).
describe("alert-engine dispatchCronAlert preserves error state (HF-A6)", () => {
  it("cron error tick routes via onError; newState is 'error', not fabricated 'red'", async () => {
    const bus = createEventBus();
    const renderer = createRenderer();
    const store = memStore();
    const sent: unknown[] = [];
    const target: Target = {
      kind: "slack_webhook",
      async send(r) {
        sent.push(r);
      },
    };
    const tMap = new Map([["slack_webhook", target]]);
    const e = createAlertEngine({
      bus,
      renderer,
      stateStore: store,
      targets: tMap,
      logger,
      now: () => new Date("2026-04-20T01:00:00Z"),
      env: { dashboardUrl: "https://d", repo: "r/r" },
      bootstrapWindowMs: 0,
    });
    e.start();
    e.reload([
      {
        id: "cron-err-state",
        name: "x",
        owner: "@oss",
        severity: "warn",
        signal: { dimension: "pin_drift" },
        stringTriggers: [],
        cronTriggers: [{ schedule: "0 10 * * 1" }],
        conditions: { guards: [], escalations: [] },
        targets: [{ kind: "slack_webhook", webhook: "w" }],
        template: { text: "main" },
        onError: { template: { text: "ERR {{signal.errorDesc}}" } },
        actions: [],
      } as unknown as CompiledRule,
    ]);
    bus.emit("rule.scheduled", {
      ruleId: "cron-err-state",
      scheduledAt: "2026-04-20T10:00:00Z",
      result: {
        key: "pin_drift:weekly",
        state: "error",
        signal: { errorDesc: "GHCR 500" },
        observedAt: "2026-04-20T10:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(1);
    const text = (sent[0] as { payload: { text: string } }).payload.text;
    // Routed to onError; main template would print "main".
    expect(text).toBe("ERR GHCR 500");
    e.stop();
  });
});

// Regression: dispatchCronAlert must NOT early-return when a rule declares only
// `on_error` + a cron trigger and omits the top-level `template` field. Pre-fix
// the `if (!rule.template) return;` guard skipped the entire tick before the
// onError branch could run, silencing an otherwise-schema-valid rule shape.
// RuleSchema.template is optional (src/rules/schema.ts:143) so this shape is
// legal; the fix scopes the early-return to the case where neither path has a
// template to render (no top-level, and tick won't route to onError).
describe("alert-engine dispatchCronAlert onError-only rule", () => {
  it("fires onError on cron error tick when rule has no top-level template", async () => {
    const bus = createEventBus();
    const renderer = createRenderer();
    const store = memStore();
    const sent: unknown[] = [];
    const target: Target = {
      kind: "slack_webhook",
      async send(r) {
        sent.push(r);
      },
    };
    const tMap = new Map([["slack_webhook", target]]);
    const e = createAlertEngine({
      bus,
      renderer,
      stateStore: store,
      targets: tMap,
      logger,
      now: () => new Date("2026-04-20T01:00:00Z"),
      env: { dashboardUrl: "https://d", repo: "r/r" },
      bootstrapWindowMs: 0,
    });
    e.start();
    e.reload([
      {
        id: "cron-onerror-only",
        name: "x",
        owner: "@oss",
        severity: "warn",
        signal: { dimension: "pin_drift" },
        stringTriggers: [],
        cronTriggers: [{ schedule: "0 10 * * 1" }],
        conditions: { guards: [], escalations: [] },
        targets: [{ kind: "slack_webhook", webhook: "w" }],
        // No top-level `template` — only onError is declared.
        onError: { template: { text: "errored! {{signal.errorDesc}}" } },
        actions: [],
      },
    ]);
    bus.emit("rule.scheduled", {
      ruleId: "cron-onerror-only",
      scheduledAt: "2026-04-20T10:00:00Z",
      result: {
        key: "pin_drift:weekly",
        state: "error",
        signal: { errorDesc: "GHCR 500" },
        observedAt: "2026-04-20T10:00:00Z",
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(1);
    const text = (sent[0] as { payload: { text: string } }).payload.text;
    expect(text).toBe("errored! GHCR 500");
    e.stop();
  });
});

