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
import type { AlertStateRecord, Target, ProbeResult } from "../types/index.js";
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
    // Seed alert_state so lastAlertAgeMin is small.
    await store.record("smoke-red-tick", "smoke:mastra:sustained_red", {
      at: "2026-04-20T00:55:00Z",
      hash: "h",
      preview: "",
    });
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
        stringTriggers: [],
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
});
