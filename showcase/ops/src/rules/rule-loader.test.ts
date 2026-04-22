import { describe, it, expect } from "vitest";
import { createRuleLoader } from "./rule-loader.js";
import { logger } from "../logger.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import {
  emptyTriggerFlags,
  type TemplateContext,
  type TriggerFlags,
} from "../types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "../../test/fixtures/rules");

describe("rule-loader: valid fixtures", () => {
  it("loads smoke-red-tick.yml with merged defaults + escalation + guards", async () => {
    const loader = createRuleLoader({
      dir: path.join(FIXTURES, "valid"),
      logger,
    });
    const rules = await loader.load();
    expect(rules).toHaveLength(1);
    const r = rules[0]!;
    expect(r.id).toBe("smoke-red-tick");
    expect(r.severity).toBe("warn");
    expect(r.stringTriggers).toEqual([
      "green_to_red",
      "sustained_red",
      "red_to_green",
    ]);
    expect(r.conditions.guards).toHaveLength(1);
    expect(r.conditions.guards[0]).toEqual({ minDeployAgeMin: 20 });
    expect(r.conditions.escalations).toHaveLength(1);
    expect(r.conditions.escalations[0]!.whenFailCount).toBe(4);
    // Defaults + rule-level both declare the SAME target (slack_webhook /
    // oss_alerts). mergeDefaults dedupes by stable shape key so the compiled
    // rule carries a single target — previously this was 2 and caused every
    // Slack alert to fire twice.
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0]).toEqual({
      kind: "slack_webhook",
      webhook: "oss_alerts",
    });
    expect(r.conditions.rate_limit?.window).toBe("15m");
  });
});

describe("rule-loader: rate_limit: null disables the default rate-limit", () => {
  it("accepts rate_limit: null without a parse error and strips the default", async () => {
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-rl-"));
    // Defaults declare rate_limit: { window: 15m }; rule overrides with `null`.
    await fs.writeFile(
      path.join(tmp, "_defaults.yml"),
      [
        "defaults:",
        "  targets:",
        "    - kind: slack_webhook",
        "      webhook: oss_alerts",
        "  severity: warn",
        "  conditions:",
        "    rate_limit:",
        "      window: 15m",
        "",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      path.join(tmp, "weekly-report.yml"),
      [
        "id: weekly-report",
        'name: "Weekly report"',
        'owner: "@oss"',
        "signal:",
        "  dimension: pin_drift",
        "triggers:",
        "  - cron_only:",
        '      schedule: "0 10 * * 1"',
        "conditions:",
        "  rate_limit: null",
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "weekly"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
    // Rule-level null replaces the default { window: 15m } via mergeDefaults.
    expect(rules[0]!.conditions.rate_limit).toBeNull();
  });

  it("rejects a rule with a malformed suppress.when expression at load time", async () => {
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-sup-"));
    await fs.writeFile(
      path.join(tmp, "bad-suppress.yml"),
      [
        "id: bad-suppress",
        'name: "bad suppress"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "conditions:",
        "  suppress:",
        '    when: "trigger === nonsense_bareword"',
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(rules).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.file).toBe("bad-suppress.yml");
    expect(errors[0]!.error).toMatch(/invalid suppress expression/);
  });

  it("rejects a rule with an unknown filter in its template (validateFilterNames)", async () => {
    // HF13-D1 regression: the rule-loader regex must flag `truncateUtfBAD`
    // (typoed filter) so load-time validation catches the mistake instead
    // of silently passing through at render time. Pairs with the
    // triple-brace passthrough test below to pin the shared-regex contract.
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-bad-f-"));
    await fs.writeFile(
      path.join(tmp, "bad-filter.yml"),
      [
        "id: bad-filter",
        'name: "bad filter"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "summary: {{ signal.body | truncateUtfBAD }}"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(rules).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error).toMatch(/unknown filter.*truncateUtfBAD/);
  });

  it("accepts a suppress expression referencing hasCandidates (flat signal alias)", async () => {
    // Regression: cluster 6's redirect-decommission-monthly.yml references
    // the flat `hasCandidates` identifier in suppress.when. rule-loader must
    // include it in SUPPRESS_VALIDATION_VARS so the parse-time eval succeeds
    // — otherwise the rule fails at load with "unknown identifier".
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-has-"));
    await fs.writeFile(
      path.join(tmp, "has-candidates.yml"),
      [
        "id: has-candidates",
        'name: "has candidates"',
        'owner: "@oss"',
        "signal:",
        "  dimension: redirect_decommission",
        "triggers:",
        "  - cron_only:",
        '      schedule: "0 9 1 * *"',
        "conditions:",
        "  suppress:",
        '    when: "hasCandidates != true"',
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.conditions.suppress?.when).toBe("hasCandidates != true");
  });

  it("loads the real pin-drift-weekly and version-drift-weekly rules cleanly", async () => {
    const realDir = path.resolve(__dirname, "../../config/alerts");
    const loader = createRuleLoader({ dir: realDir, logger });
    const { rules, errors } = await loader.loadWithErrors();
    // Only assert the two weekly rules we know explicitly set rate_limit: null.
    const pin = rules.find((r) => r.id === "pin-drift-weekly");
    const ver = rules.find((r) => r.id === "version-drift-weekly");
    expect(pin, "pin-drift-weekly must load").toBeDefined();
    expect(ver, "version-drift-weekly must load").toBeDefined();
    // Neither should have produced an error.
    expect(errors.find((e) => e.file.startsWith("pin-drift"))).toBeUndefined();
    expect(
      errors.find((e) => e.file.startsWith("version-drift")),
    ).toBeUndefined();
    expect(pin!.conditions.rate_limit).toBeNull();
    expect(ver!.conditions.rate_limit).toBeNull();
  });

  it("R25 A1: rejects a rule with a typoed dimension ('smokee') via the closed DimensionEnum", async () => {
    // Pre-fix: `signal.dimension` was `z.string().min(1)`, so a YAML typo
    // like `smokee` passed validation and the rule silently never matched
    // any probe key — `alert-engine.handleStatusChanged` compared
    // `rule.signal.dimension !== deriveDimension(key)` and returned false
    // forever. No alert ever fired. Post-fix the Zod enum closes the rule
    // side and the load path rejects the typo with Zod's standard
    // enum-violation message listing the valid dimensions.
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-dim-"));
    await fs.writeFile(
      path.join(tmp, "bad-dimension.yml"),
      [
        "id: bad-dimension",
        'name: "bad dimension"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smokee", // typo — should be "smoke"
        "triggers:",
        "  - green_to_red",
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(rules).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.file).toBe("bad-dimension.yml");
    // Zod's invalid-enum message mentions the offending value and/or the
    // permitted set — assert BOTH the loader wrapper prefix and some marker
    // that the validation specifically flagged the dimension field.
    expect(errors[0]!.error).toMatch(/rule-loader:/);
    // Message should reference either the invalid value or the enum set so
    // the author can diagnose the typo without consulting docs.
    expect(errors[0]!.error).toMatch(/smokee|smoke|dimension|enum/i);
  });
});

describe("rule-loader: target dedupe + non-empty validation", () => {
  async function writeDir(files: Record<string, string>): Promise<string> {
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-td-"));
    for (const [name, body] of Object.entries(files)) {
      await fs.writeFile(path.join(tmp, name), body, "utf-8");
    }
    return tmp;
  }

  it("dedupes identical targets inherited from defaults AND declared on the rule", async () => {
    const dir = await writeDir({
      "_defaults.yml": [
        "defaults:",
        "  targets:",
        "    - kind: slack_webhook",
        "      webhook: oss_alerts",
        "  severity: warn",
        "  conditions:",
        "    rate_limit:",
        "      window: 15m",
        "",
      ].join("\n"),
      "dup-targets.yml": [
        "id: dup-targets",
        'name: "dup"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
    });
    const loader = createRuleLoader({ dir, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.targets).toEqual([
      { kind: "slack_webhook", webhook: "oss_alerts" },
    ]);
  });

  it("dedupes in-rule duplicate targets even when _defaults.yml has no targets", async () => {
    // Regression guard: dedupeTargets used to be gated behind
    // `if (defaults.targets)`, so a rule with two identical {kind, webhook}
    // targets in its OWN `targets:` list and a defaults file that did not
    // declare targets bypassed dedupe entirely — every Slack alert fired
    // twice. The guard now gates on the combined list being non-empty so
    // rule-only duplicates are also collapsed.
    const warnCalls: Array<{ msg: string; meta?: Record<string, unknown> }> =
      [];
    const captureLogger = {
      debug: () => {},
      info: () => {},
      warn: (msg: string, meta?: Record<string, unknown>) => {
        warnCalls.push({ msg, meta });
      },
      error: () => {},
    };
    const dir = await writeDir({
      // No targets in defaults — exercises the previously-skipped dedupe path.
      "_defaults.yml": ["defaults:", "  severity: warn", ""].join("\n"),
      "rule-only-dupes.yml": [
        "id: rule-only-dupes",
        'name: "rod"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "targets:",
        // First occurrence is the "plain" target; the second carries extra
        // metadata. First-seen wins in dedupeTargets, so the SECOND (with
        // `mention`) is dropped and its `droppedExtras` triggers the warn.
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        '    mention: "@oncall"',
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
    });
    const loader = createRuleLoader({ dir, logger: captureLogger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
    // Without the fix, `rules[0]!.targets` is length 2 and the alert fires
    // twice per tick. With the fix, first-seen wins and the dedupe-drop
    // warn is emitted.
    expect(rules[0]!.targets).toHaveLength(1);
    expect(rules[0]!.targets[0]!.kind).toBe("slack_webhook");
    expect(rules[0]!.targets[0]!.webhook).toBe("oss_alerts");
    const drop = warnCalls.find(
      (c) => c.msg === "rule-loader.target-dedupe-dropped-metadata",
    );
    expect(drop).toBeDefined();
    expect(drop!.meta?.ruleId).toBe("rule-only-dupes");
  });

  it("keeps targets that differ by webhook — dedupe is by shape, not kind alone", async () => {
    const dir = await writeDir({
      "_defaults.yml": [
        "defaults:",
        "  targets:",
        "    - kind: slack_webhook",
        "      webhook: oss_alerts",
        "  severity: warn",
        "",
      ].join("\n"),
      "distinct-webhooks.yml": [
        "id: distinct-webhooks",
        'name: "dw"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oncall",
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
    });
    const loader = createRuleLoader({ dir, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(errors).toEqual([]);
    expect(rules[0]!.targets).toEqual([
      { kind: "slack_webhook", webhook: "oss_alerts" },
      { kind: "slack_webhook", webhook: "oncall" },
    ]);
  });

  it("surfaces _defaults.yml schema violations as a defaults-level error (no longer fatal)", async () => {
    // Finding 14: the schema previously accepted `renderer` but loader
    // dropped it. Authors got silent no-ops. Removed from schema so a
    // stray declaration surfaces at load time with a clear message.
    // HF-B4: align with per-rule-file tolerance — a bad _defaults.yml
    // must NOT kill the entire load. The error surfaces at
    // `file: "_defaults.yml"` and valid rule files continue loading.
    const dir = await writeDir({
      "_defaults.yml": [
        "defaults:",
        "  severity: warn",
        "  renderer: mustache",
        "",
      ].join("\n"),
    });
    const loader = createRuleLoader({ dir, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(rules).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.file).toBe("_defaults.yml");
    expect(errors[0]!.error).toMatch(/Unrecognized key.*renderer/);
  });

  it("HF-B4: invalid _defaults.yml YAML still loads valid rule files", async () => {
    // Red-green: a YAML typo in _defaults.yml must surface as a
    // defaults-level error WITHOUT aborting rules loading.
    const dir = await writeDir({
      // Deliberately malformed YAML (unbalanced brace).
      "_defaults.yml": ["defaults: {severity: warn", ""].join("\n"),
      "ok.yml": [
        "id: ok",
        'name: "ok"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
    });
    const loader = createRuleLoader({ dir, logger });
    const { rules, errors } = await loader.loadWithErrors();
    // Valid rule file still loads despite defaults parse error.
    expect(rules).toHaveLength(1);
    expect(rules[0]!.id).toBe("ok");
    // Defaults error surfaces in the error list.
    const defaultsErr = errors.find((e) => e.file === "_defaults.yml");
    expect(defaultsErr).toBeDefined();
    expect(defaultsErr!.error).toMatch(/_defaults\.yml/);
  });

  it("dedupe is keyed by {kind,webhook} only — ignores passthrough extras", async () => {
    // Regression guard for Finding 8: TargetSchema uses .passthrough(),
    // so rule-level targets can carry arbitrary extras (mention, labels).
    // Dedupe must collapse targets that point at the same destination
    // regardless of attached metadata. Previously the stringify-by-object
    // key meant `{kind, webhook, mention: "@oncall"}` and `{kind, webhook}`
    // hashed to different keys — every matched alert fired TWICE.
    const dir = await writeDir({
      "_defaults.yml": [
        "defaults:",
        "  targets:",
        "    - kind: slack_webhook",
        "      webhook: oss_alerts",
        "  severity: warn",
        "",
      ].join("\n"),
      "dup-with-extras.yml": [
        "id: dup-with-extras",
        'name: "dwe"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "targets:",
        // Same routing identity as the default, but with an extra field.
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        '    mention: "@oncall"',
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
    });
    const loader = createRuleLoader({ dir, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
    // First occurrence wins — the default's shape (without `mention`) survives.
    expect(rules[0]!.targets).toHaveLength(1);
    expect(rules[0]!.targets[0]!.kind).toBe("slack_webhook");
    expect(rules[0]!.targets[0]!.webhook).toBe("oss_alerts");
  });

  it("fails compile when a rule has zero targets after merge", async () => {
    // Defaults declare no targets, rule declares no targets → compile must throw.
    const dir = await writeDir({
      "_defaults.yml": ["defaults:", "  severity: warn", ""].join("\n"),
      "no-targets.yml": [
        "id: no-targets",
        'name: "nt"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
    });
    const loader = createRuleLoader({ dir, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(rules).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.file).toBe("no-targets.yml");
    expect(errors[0]!.error).toMatch(/at least one target/);
  });
});

describe("rule-loader: invalid fixtures (skipped, not fatal)", () => {
  // Each bad fixture must be surfaced via loadWithErrors().errors rather than
  // killing the whole load. load() returns the valid rules (none in these
  // single-file fixture dirs) without throwing.
  const cases: Array<[string, RegExp]> = [
    ["bad-trigger.yml", /bad-trigger/],
    ["missing-id.yml", /missing-id|id/i],
    ["empty-triggers.yml", /empty-triggers|triggers/],
    ["invalid-severity.yml", /invalid-severity|severity/],
    ["unknown-top-level.yml", /unknown-top-level|nope/],
    ["triple-brace-unsafe.yml", /triple-brace-unsafe|slackSafe|triple-brace/],
    ["unknown-signal-filter-key.yml", /unknown-signal-filter-key|nonsense/],
    ["unknown-action-kind.yml", /unknown-action-kind|nuke|kind/],
  ];

  for (const [fixture, expectedMsg] of cases) {
    it(`surfaces ${fixture} via errors without throwing`, async () => {
      const dir = await makeSingleFixtureDir(fixture);
      const loader = createRuleLoader({ dir, logger });
      const { rules, errors } = await loader.loadWithErrors();
      expect(rules).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.file).toBe(fixture);
      expect(errors[0]!.error).toMatch(expectedMsg);
    });
  }

  it("one bad file does NOT prevent loading valid siblings", async () => {
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-mixed-"));
    // Copy valid fixture + _defaults.
    await fs.copyFile(
      path.join(FIXTURES, "valid", "_defaults.yml"),
      path.join(tmp, "_defaults.yml"),
    );
    await fs.copyFile(
      path.join(FIXTURES, "valid", "smoke-red-tick.yml"),
      path.join(tmp, "smoke-red-tick.yml"),
    );
    // Drop a broken file alongside.
    await fs.copyFile(
      path.join(FIXTURES, "invalid", "missing-id.yml"),
      path.join(tmp, "missing-id.yml"),
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.id).toBe("smoke-red-tick");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.file).toBe("missing-id.yml");
  });
});

describe("rule-loader: reload error propagation", () => {
  it("surfaces per-file errors to a caller via loadWithErrors", async () => {
    // Emitter wiring is a thin pass-through inside watch(); exercising it
    // through a real chokidar watcher is flaky across macOS file-event
    // latencies. Drive the same code path deterministically by invoking
    // loadWithErrors() on a mixed-valid/invalid directory — it's the exact
    // function watch() calls on every tick.
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-mix-"));
    await fs.copyFile(
      path.join(FIXTURES, "valid", "_defaults.yml"),
      path.join(tmp, "_defaults.yml"),
    );
    await fs.copyFile(
      path.join(FIXTURES, "valid", "smoke-red-tick.yml"),
      path.join(tmp, "smoke-red-tick.yml"),
    );
    await fs.copyFile(
      path.join(FIXTURES, "invalid", "missing-id.yml"),
      path.join(tmp, "missing-id.yml"),
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(rules.map((r) => r.id)).toEqual(["smoke-red-tick"]);
    expect(errors.map((e) => e.file)).toEqual(["missing-id.yml"]);
  });

  it("watch() accepts a RuleLoadErrorEmitter without runtime error", () => {
    // Structural-compat contract check: construction must accept any emitter
    // whose .emit handles the rules.reload.failed event signature.
    const events: Array<unknown> = [];
    const emitter = {
      emit(
        _event: "rules.reload.failed",
        payload: { errors: { file: string; error: string }[] },
      ): void {
        events.push(payload);
      },
    };
    const loader = createRuleLoader({
      dir: path.join(FIXTURES, "valid"),
      logger,
      bus: emitter,
    });
    const unsub = loader.watch(() => {});
    // No-op; we're only checking the code path runs + cleans up.
    unsub();
    expect(events).toEqual([]);
  });
});

describe("rule-loader: rate_limit.perKey filter-pipeline validation (A3)", () => {
  it("rejects perKey containing filter tokens ('|') at load time", async () => {
    // A3: `alert-engine.buildDedupeKey` renders perKey via `Mustache.render`
    // directly, bypassing the renderer's filter pipeline. Filter tokens
    // inside perKey would silently corrupt the dedupe key at runtime.
    // Rule-loader must catch this at boot.
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-pk-"));
    await fs.writeFile(
      path.join(tmp, "bad-perkey.yml"),
      [
        "id: bad-perkey",
        'name: "bad perKey"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "conditions:",
        "  rate_limit:",
        "    window: 15m",
        '    perKey: "{{ signal.slug | stripAnsi }}"',
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(rules).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error).toMatch(/rate_limit\.perKey.*filter pipeline/);
  });

  it("accepts perKey with plain Mustache interpolation (no filters)", async () => {
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-pk-ok-"));
    await fs.writeFile(
      path.join(tmp, "ok-perkey.yml"),
      [
        "id: ok-perkey",
        'name: "ok perKey"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "conditions:",
        "  rate_limit:",
        "    window: 15m",
        '    perKey: "{{signal.slug}}:{{triggerName}}"',
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.conditions.rate_limit?.perKey).toBe(
      "{{signal.slug}}:{{triggerName}}",
    );
  });
});

// CR R19 bucket-(a): renderer-integration coverage for three YAML fixes
// that touched templates or trigger lists without TS changes. These tests
// load the REAL config/alerts YAML via the rule-loader, then render the
// compiled template through the real Mustache renderer with a synthetic
// TemplateContext. The purpose is red-green coverage on the YAML changes
// themselves — if any of these three templates regress (missing trigger,
// wrong field name, missing branch), the assertion substring fails.
describe("rule-loader + renderer: CR R19 YAML fixes", () => {
  it("version-drift-weekly: probeErrored branch renders npm/python error descriptions (not signal.errorMessage)", async () => {
    const { createRenderer } = await import("../render/renderer.js");
    const realDir = path.resolve(__dirname, "../../config/alerts");
    const loader = createRuleLoader({ dir: realDir, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(
      errors.find((e) => e.file.startsWith("version-drift-weekly")),
    ).toBeUndefined();
    const rule = rules.find((r) => r.id === "version-drift-weekly");
    expect(rule, "version-drift-weekly must load").toBeDefined();
    // The template must NOT reference the non-existent signal.errorMessage.
    expect(rule!.template!.text).not.toContain("signal.errorMessage");
    // It must reference the actual probe-emitted fields.
    expect(rule!.template!.text).toContain("signal.npmProbeErrorDesc");
    expect(rule!.template!.text).toContain("signal.pythonProbeErrorDesc");

    // Render with a synthetic probeErrored signal; assert the error message
    // appears in the rendered output.
    const renderer = createRenderer();
    const rendered = renderer.render(
      { text: rule!.template!.text },
      {
        rule: {
          id: rule!.id,
          name: rule!.name,
          owner: rule!.owner,
          severity: rule!.severity,
        },
        trigger: {
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
        },
        escalated: false,
        signal: {
          driftType: { probeErrored: true },
          npmProbeErrorDesc: "npm registry 500",
          pythonProbeErrorDesc: "",
        },
        event: { id: "e1", at: "2026-04-20T00:00:00Z", runUrl: "https://run" },
        env: { dashboardUrl: "https://d", repo: "r/r" },
      },
    );
    expect((rendered.payload as { text: string }).text).toContain(
      "npm registry 500",
    );
    expect((rendered.payload as { text: string }).text).toContain(
      "probe errored",
    );
    // And non-empty — the core bug was "alert fires with empty message".
    expect(
      (rendered.payload as { text: string }).text.trim().length,
    ).toBeGreaterThan(0);
  });

  it("deploy-result: cancelled_prebuild is in triggers list AND template branch renders", async () => {
    const { createRenderer } = await import("../render/renderer.js");
    const realDir = path.resolve(__dirname, "../../config/alerts");
    const loader = createRuleLoader({ dir: realDir, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(
      errors.find((e) => e.file.startsWith("deploy-result")),
    ).toBeUndefined();
    const rule = rules.find((r) => r.id === "deploy-result");
    expect(rule, "deploy-result must load").toBeDefined();
    // Trigger must be declared; otherwise resolveTriggers silently drops it.
    expect(rule!.stringTriggers).toContain("cancelled_prebuild");
    // Template must render something for cancelled_prebuild.
    expect(rule!.template!.text).toContain("trigger.cancelled_prebuild");

    const renderer = createRenderer();
    const rendered = renderer.render(
      { text: rule!.template!.text },
      {
        rule: {
          id: rule!.id,
          name: rule!.name,
          owner: rule!.owner,
          severity: rule!.severity,
        },
        trigger: {
          green_to_red: false,
          red_to_green: false,
          sustained_red: false,
          sustained_green: false,
          first: false,
          set_changed: false,
          cancelled_prebuild: true,
          cancelled_midmatrix: false,
          stable: false,
          regressed: false,
          improved: false,
          set_drifted: false,
          set_errored: false,
          gate_skipped: false,
          isRedTick: false,
        },
        escalated: false,
        signal: { cancelledPreBuild: true },
        event: { id: "e1", at: "2026-04-20T00:00:00Z", runUrl: "https://run" },
        env: { dashboardUrl: "https://d", repo: "r/r" },
      },
    );
    expect((rendered.payload as { text: string }).text).toContain(
      "cancelled before any build started",
    );
  });

  it("redirect-decommission-monthly: probeErrored branch renders probeErrorDesc (body branch otherwise)", async () => {
    const { createRenderer } = await import("../render/renderer.js");
    const realDir = path.resolve(__dirname, "../../config/alerts");
    // redirect-decommission template uses triple-brace `{{{signal.body}}}`
    // which the loader rejects unless `body` is marked slackSafe on the
    // redirect_decommission dimension (see orchestrator.ts wiring).
    const loader = createRuleLoader({
      dir: realDir,
      logger,
      slackSafeFields: { redirect_decommission: new Set(["body"]) },
    });
    const { rules, errors } = await loader.loadWithErrors();
    expect(
      errors.find((e) => e.file.startsWith("redirect-decommission-monthly")),
    ).toBeUndefined();
    const rule = rules.find((r) => r.id === "redirect-decommission-monthly");
    expect(rule, "redirect-decommission-monthly must load").toBeDefined();
    expect(rule!.template!.text).toContain("signal.probeErrored");
    expect(rule!.template!.text).toContain("signal.probeErrorDesc");

    const renderer = createRenderer();
    const baseCtx = {
      rule: {
        id: rule!.id,
        name: rule!.name,
        owner: rule!.owner,
        severity: rule!.severity,
      },
      trigger: {
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
      },
      escalated: false,
      event: { id: "e1", at: "2026-04-20T00:00:00Z", runUrl: "https://run" },
      env: { dashboardUrl: "https://d", repo: "r/r" },
    } as const;

    // probeErrored=true → probeErrorDesc appears, body does NOT.
    const errored = renderer.render(
      { text: rule!.template!.text },
      {
        ...baseCtx,
        signal: {
          probeErrored: true,
          probeErrorDesc: "audit script failed",
          body: "SHOULD NOT APPEAR",
        },
      },
    );
    const erroredText = (errored.payload as { text: string }).text;
    expect(erroredText).toContain("audit script failed");
    expect(erroredText).toContain("Redirect-decommission audit failed");
    expect(erroredText).not.toContain("SHOULD NOT APPEAR");

    // probeErrored=false (normal audit with candidates) → body appears.
    const normal = renderer.render(
      { text: rule!.template!.text },
      {
        ...baseCtx,
        signal: {
          probeErrored: false,
          body: "2 candidates ready to decommission",
        },
      },
    );
    const normalText = (normal.payload as { text: string }).text;
    expect(normalText).toContain("2 candidates ready to decommission");
    expect(normalText).not.toContain("Redirect-decommission audit failed");
  });
});

// CR R20 bucket-(a): full YAML contract coverage. Closes the
// YAML<->probe drift gap that produced R13/R15/R17/R19 findings. Every
// rule in config/alerts/ is loaded via the real rule-loader and each
// template branch is rendered with a TemplateContext shaped to match
// the ACTUAL probe signal. Red-green verified: a representative subset
// was mutated (YAML break or signal field rename) pre-landing to confirm
// the assertions go red, then restored to green. See commit log.
describe("rule-loader + renderer: full YAML contract coverage", () => {
  // Shared helpers -----------------------------------------------------
  const REAL_CONFIG_DIR = path.resolve(__dirname, "../../config/alerts");

  /** Build a baseline TemplateContext. Signal is caller-supplied. */
  function makeCtx(
    rule: { id: string; name: string; owner: string; severity: string },
    signal: Record<string, unknown>,
    overrides: {
      trigger?: Partial<TriggerFlags>;
      escalated?: boolean;
      event?: Partial<TemplateContext["event"]>;
      env?: Partial<TemplateContext["env"]>;
    } = {},
  ): TemplateContext {
    const trigger: TriggerFlags = {
      ...emptyTriggerFlags(),
      ...(overrides.trigger ?? {}),
    };
    return {
      rule: {
        id: rule.id,
        name: rule.name,
        owner: rule.owner,
        severity: rule.severity as TemplateContext["rule"]["severity"],
      },
      trigger,
      escalated: overrides.escalated ?? false,
      signal,
      event: {
        id: "e1",
        at: "2026-04-20T00:00:00Z",
        runUrl: "https://run.example/1",
        runId: "run-1",
        jobUrl: "https://job.example/1",
        ...(overrides.event ?? {}),
      },
      env: {
        dashboardUrl: "https://dashboard.example",
        repo: "cpk/showcase",
        ...(overrides.env ?? {}),
      },
    };
  }

  async function loadRealRules() {
    const { createRenderer } = await import("../render/renderer.js");
    // Per-dimension slackSafe sets must mirror orchestrator.ts wiring so the
    // whole-dir load succeeds. Other dimensions triple-brace only
    // event.*/env.* which are handled by validateTripleBrace.
    const { REDIRECT_DECOMMISSION_SLACK_SAFE_FIELDS } =
      await import("../probes/redirect-decommission.js");
    const { SMOKE_SLACK_SAFE_FIELDS } = await import("../probes/smoke.js");
    // Mirror orchestrator.ts L1-L4 safe-field wiring: agent/chat/tools have
    // no probe module, so their safe-field set is defined inline (errorDesc
    // only, pre-sanitized by the shared smoke driver).
    const L1_L4_SLACK_SAFE_FIELDS = ["errorDesc"] as const;
    const loader = createRuleLoader({
      dir: REAL_CONFIG_DIR,
      logger,
      slackSafeFields: {
        redirect_decommission: new Set(REDIRECT_DECOMMISSION_SLACK_SAFE_FIELDS),
        smoke: new Set(SMOKE_SLACK_SAFE_FIELDS),
        agent: new Set(L1_L4_SLACK_SAFE_FIELDS),
        chat: new Set(L1_L4_SLACK_SAFE_FIELDS),
        tools: new Set(L1_L4_SLACK_SAFE_FIELDS),
      },
    });
    const { rules, errors } = await loader.loadWithErrors();
    return { rules, errors, renderer: createRenderer() };
  }

  // ---- aimock-wiring-drift.yml --------------------------------------
  describe("aimock-wiring-drift", () => {
    it("set_drifted branch renders unwired list + count + fix hint", async () => {
      const { rules, errors, renderer } = await loadRealRules();
      expect(
        errors.find((e) => e.file.startsWith("aimock-wiring-drift")),
      ).toBeUndefined();
      const rule = rules.find((r) => r.id === "aimock-wiring-drift");
      expect(rule, "aimock-wiring-drift must load").toBeDefined();
      // Trigger declared → otherwise resolveTriggers silently drops.
      expect(rule!.stringTriggers).toEqual([
        "set_drifted",
        "set_errored",
        "red_to_green",
      ]);
      const ctx = makeCtx(
        rule!,
        {
          unwired: ["svc-a", "svc-b"],
          unwiredCount: 2,
          unwiredNoun: "services",
          erroredPreview: [],
          probeErrorDesc: "",
        },
        { trigger: { set_drifted: true } },
      );
      const text = (
        renderer.render({ text: rule!.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("aimock wiring drift");
      expect(text).toContain("2 services bypassing");
      expect(text).toContain("svc-a");
      expect(text).toContain("svc-b");
      expect(text).toContain("OPENAI_BASE_URL");
      expect(text.trim().length).toBeGreaterThan(0);
    });

    it("set_errored branch renders erroredCount + erroredPreview + probeErrorDesc", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "aimock-wiring-drift")!;
      const ctx = makeCtx(
        rule,
        {
          unwired: [],
          unwiredCount: 0,
          unwiredNoun: "services",
          erroredCount: 3,
          erroredPreview: ["svc-1: timeout", "svc-2: 500", "svc-3: auth"],
          probeErrorDesc: "Railway API 502",
        },
        { trigger: { set_errored: true } },
      );
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("aimock wiring probe errored");
      expect(text).toContain("3 service");
      expect(text).toContain("svc-1: timeout");
      expect(text).toContain("svc-2: 500");
      expect(text).toContain("svc-3: auth");
      expect(text).toContain("Probe error: `Railway API 502`");
    });

    it("red_to_green branch renders recovery message", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "aimock-wiring-drift")!;
      const ctx = makeCtx(rule, {}, { trigger: { red_to_green: true } });
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("aimock wiring recovered");
      expect(text).toContain("Dashboard");
    });

    // R24 bucket-(a) item 1: Run link URL must pass through unescaped.
    // Pre-fix: `<{{.}}|Run>` double-brace inside `{{#event.runUrl}}`
    // HTML-escapes `&` in GitHub Actions run URL query strings
    // (`?check_suite_focus=true&foo=bar` → `&amp;`), breaking the Slack
    // link parser. Same bug class as R20.5 smoke-red-tick fix
    // (commit 273a7ae25) — signal.links.* double-brace scrambled `/` to
    // `&#x2F;`. Fix uses triple-brace on known-safe `event.runUrl`.
    it("set_drifted branch: Run link preserves raw URL query string (no &amp;)", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "aimock-wiring-drift")!;
      const runUrl =
        "https://github.com/foo/bar/actions/runs/123?check_suite_focus=true&foo=baz";
      const ctx = makeCtx(
        rule,
        {
          unwired: ["svc-a"],
          unwiredCount: 1,
          unwiredNoun: "service",
          erroredPreview: [],
          probeErrorDesc: "",
        },
        { trigger: { set_drifted: true }, event: { runUrl } },
      );
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      // Raw URL (including literal `&`) must survive to Slack. Pre-fix the
      // `&` was HTML-escaped to `&amp;` by default double-brace, breaking
      // the link parser.
      expect(text).toContain(runUrl);
      expect(text).not.toContain("&amp;");
    });

    it("set_errored branch: Run link preserves raw URL query string (no &amp;)", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "aimock-wiring-drift")!;
      const runUrl =
        "https://github.com/foo/bar/actions/runs/456?check_suite_focus=true&foo=baz";
      const ctx = makeCtx(
        rule,
        {
          unwired: [],
          unwiredCount: 0,
          unwiredNoun: "services",
          erroredCount: 1,
          erroredPreview: ["svc-1: timeout"],
          probeErrorDesc: "Railway API 502",
        },
        { trigger: { set_errored: true }, event: { runUrl } },
      );
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain(runUrl);
      expect(text).not.toContain("&amp;");
    });

    it("red_to_green branch: Run link preserves raw URL query string (no &amp;)", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "aimock-wiring-drift")!;
      const runUrl =
        "https://github.com/foo/bar/actions/runs/789?check_suite_focus=true&foo=baz";
      const ctx = makeCtx(
        rule,
        {},
        {
          trigger: { red_to_green: true },
          event: { runUrl },
        },
      );
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain(runUrl);
      expect(text).not.toContain("&amp;");
    });
  });

  // ---- e2e-smoke-failure.yml ----------------------------------------
  describe("e2e-smoke-failure", () => {
    it("green_to_red (isRedTick) branch renders failureSummary inside code fence", async () => {
      const { rules, errors, renderer } = await loadRealRules();
      expect(
        errors.find((e) => e.file.startsWith("e2e-smoke-failure")),
      ).toBeUndefined();
      const rule = rules.find((r) => r.id === "e2e-smoke-failure");
      expect(rule).toBeDefined();
      expect(rule!.stringTriggers).toEqual([
        "green_to_red",
        "sustained_red",
        "red_to_green",
      ]);
      const ctx = makeCtx(
        rule!,
        {
          suite: "L2",
          failureSummary: "assertion failed at step 3\nstack: ...\n",
        },
        { trigger: { green_to_red: true, isRedTick: true } },
      );
      const text = (
        renderer.render({ text: rule!.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("Showcase E2E suite failed");
      expect(text).toContain("assertion failed at step 3");
      // Code fence framing survives truncateUtf8 and stripAnsi filters.
      expect(text).toContain("```");
    });

    it("sustained_red (isRedTick) branch renders failureSummary", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "e2e-smoke-failure")!;
      const ctx = makeCtx(
        rule,
        {
          suite: "L1",
          failureSummary: "still red: timeout",
        },
        { trigger: { sustained_red: true, isRedTick: true } },
      );
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("still red: timeout");
      expect(text).toContain("Showcase E2E suite failed");
    });

    it("red_to_green branch renders recovery with run link", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "e2e-smoke-failure")!;
      const ctx = makeCtx(
        rule,
        { suite: "L2", failureSummary: "" },
        {
          trigger: { red_to_green: true },
        },
      );
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("Showcase E2E suite recovered");
      expect(text).toContain("https://run.example/1");
    });
  });

  // ---- image-drift.yml ----------------------------------------------
  describe("image-drift", () => {
    it("set_changed branch renders staleServices + errored counts", async () => {
      const { rules, errors, renderer } = await loadRealRules();
      expect(
        errors.find((e) => e.file.startsWith("image-drift")),
      ).toBeUndefined();
      const rule = rules.find((r) => r.id === "image-drift");
      expect(rule).toBeDefined();
      expect(rule!.stringTriggers).toEqual(["set_changed", "set_errored"]);
      const ctx = makeCtx(
        rule!,
        {
          staleServices: ["svc-a", "svc-b"],
          errored: [],
          triggered: ["svc-a", "svc-b"],
          rebuildNoun: "rebuilds",
          staleServicesCount: 2,
          erroredCount: 0,
          triggeredCount: 2,
        },
        { trigger: { set_changed: true } },
      );
      const text = (
        renderer.render({ text: rule!.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("Image drift detected");
      expect(text).toContain("2 rebuilds triggered");
      expect(text).toContain("0 errored");
    });

    it("set_errored branch renders errored count (stale=0, errored=1)", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "image-drift")!;
      const ctx = makeCtx(
        rule,
        {
          staleServices: [],
          errored: ["ghcr-down-svc"],
          triggered: ["ghcr-down-svc"],
          rebuildNoun: "rebuild",
          staleServicesCount: 0,
          erroredCount: 1,
          triggeredCount: 1,
        },
        { trigger: { set_errored: true } },
      );
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("Image drift detected");
      expect(text).toContain("0 rebuild triggered");
      expect(text).toContain("1 errored");
    });
  });

  // ---- pin-drift-weekly.yml -----------------------------------------
  describe("pin-drift-weekly", () => {
    it("noBaseline=true branch renders first-run notice without setStatus leak", async () => {
      const { rules, errors, renderer } = await loadRealRules();
      expect(
        errors.find((e) => e.file.startsWith("pin-drift-weekly")),
      ).toBeUndefined();
      const rule = rules.find((r) => r.id === "pin-drift-weekly");
      expect(rule).toBeDefined();
      // Cron-only rule → stringTriggers empty, cronTriggers populated.
      expect(rule!.stringTriggers).toEqual([]);
      expect(rule!.cronTriggers.length).toBeGreaterThan(0);
      const ctx = makeCtx(
        rule!,
        {
          actualCount: 5,
          baselineCount: null,
          setStatus: "no_baseline",
          noBaseline: true,
          stable: false,
          regressed: false,
          improved: false,
        },
        { trigger: { first: true } },
      );
      const text = (
        renderer.render({ text: rule!.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("FAIL=5");
      expect(text).toContain("first run — no baseline yet");
      // The raw enum tag must NOT leak to Slack on the first-run branch.
      expect(text).not.toContain("[no_baseline]");
    });

    it("noBaseline=false stable branch renders actual + baseline + setStatus", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "pin-drift-weekly")!;
      const ctx = makeCtx(
        rule,
        {
          actualCount: 3,
          baselineCount: 3,
          setStatus: "stable",
          noBaseline: false,
          stable: true,
          regressed: false,
          improved: false,
        },
        { trigger: { first: true } },
      );
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("FAIL=3");
      expect(text).toContain("baseline 3");
      expect(text).toContain("[stable]");
      expect(text).not.toContain("first run");
    });

    it("noBaseline=false regressed branch renders setStatus=regressed", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "pin-drift-weekly")!;
      const ctx = makeCtx(
        rule,
        {
          actualCount: 7,
          baselineCount: 3,
          setStatus: "regressed",
          noBaseline: false,
          stable: false,
          regressed: true,
          improved: false,
        },
        { trigger: { first: true } },
      );
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("FAIL=7");
      expect(text).toContain("baseline 3");
      expect(text).toContain("[regressed]");
    });

    it("on_error template renders job-failed message", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "pin-drift-weekly")!;
      expect(rule.onError).toBeDefined();
      const ctx = makeCtx(rule, {}, {});
      const text = (
        renderer.render(rule.onError!.template, ctx).payload as { text: string }
      ).text;
      expect(text).toContain("job failed");
      expect(text).toContain("https://run.example/1");
    });
  });

  // ---- smoke-red-tick.yml -------------------------------------------
  describe("smoke-red-tick", () => {
    it("green_to_red branch renders slug, errorDesc and smoke/health links", async () => {
      const { rules, errors, renderer } = await loadRealRules();
      expect(
        errors.find((e) => e.file.startsWith("smoke-red-tick")),
      ).toBeUndefined();
      const rule = rules.find((r) => r.id === "smoke-red-tick");
      expect(rule).toBeDefined();
      expect(rule!.stringTriggers).toEqual([
        "green_to_red",
        "sustained_red",
        "red_to_green",
      ]);
      const ctx = makeCtx(
        rule!,
        {
          slug: "coagents-starter",
          errorDesc: "http 503",
          links: {
            smoke: "https://svc.example/smoke",
            health: "https://svc.example/health",
          },
          failCount: 1,
        },
        { trigger: { green_to_red: true, isRedTick: true } },
      );
      const text = (
        renderer.render({ text: rule!.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("coagents-starter");
      expect(text).toContain("down, error: http 503");
      // Triple-brace signal.links.* (added via SMOKE_SLACK_SAFE_FIELDS)
      // preserves the raw URL inside `<URL|label>` Slack link markup;
      // prior double-brace form HTML-escaped `/` → `&#x2F;` and broke
      // the link at Slack render time.
      expect(text).toContain("https://svc.example/smoke");
      expect(text).toContain("https://svc.example/health");
    });

    it("sustained_red branch renders failCount (attempt: N) and error", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "smoke-red-tick")!;
      const ctx = makeCtx(
        rule,
        {
          slug: "mastra-starter",
          errorDesc: "timeout after 15000ms",
          links: {
            smoke: "https://m.example/smoke",
            health: "https://m.example/health",
          },
          failCount: 3,
        },
        { trigger: { sustained_red: true, isRedTick: true } },
      );
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("mastra-starter");
      expect(text).toContain("attempt: 3");
      expect(text).toContain("timeout after 15000ms");
    });

    it("red_to_green branch renders recovery + firstFailureAt", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "smoke-red-tick")!;
      const ctx = makeCtx(
        rule,
        {
          slug: "langgraph-starter",
          firstFailureAt: "2026-04-19T23:00:00Z",
        },
        { trigger: { red_to_green: true } },
      );
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("langgraph-starter");
      expect(text).toContain("recovered");
      expect(text).toContain("was down since 2026-04-19T23:00:00Z");
    });

    it("fleet rule owns <!channel> escalation (migrated from per-service red-tick)", async () => {
      // Plan Item 4: <!channel> moved off smoke-red-tick onto smoke-red-fleet.
      // The per-service rule still fires per-match via its own targets; the
      // fleet rule is the single pager for cross-service outages. Per-service
      // red-tick template must NOT contain <!channel>; fleet rule template
      // MUST. Both invariants asserted together so a future refactor can't
      // silently drop one without the other surfacing.
      const { rules } = await loadRealRules();
      const perService = rules.find((r) => r.id === "smoke-red-tick")!;
      const fleet = rules.find((r) => r.id === "smoke-red-fleet")!;
      expect(perService.template!.text).not.toContain("<!channel>");
      expect(fleet.aggregation).toBeDefined();
      expect(fleet.aggregation!.template).toContain("<!channel>");
    });
  });

  // ---- deploy-result.yml (remaining branches R20 didn't cover) ------
  describe("deploy-result (R20 follow-up branches)", () => {
    it("green_to_red partial branch renders failed/succeeded lists", async () => {
      const { rules, errors, renderer } = await loadRealRules();
      expect(
        errors.find((e) => e.file.startsWith("deploy-result")),
      ).toBeUndefined();
      const rule = rules.find((r) => r.id === "deploy-result")!;
      expect(rule.stringTriggers).toEqual([
        "green_to_red",
        "red_to_green",
        "cancelled_midmatrix",
        "cancelled_prebuild",
        "gate_skipped",
      ]);
      const ctx = makeCtx(
        rule,
        {
          partial: true,
          failedCount: 2,
          totalCount: 5,
          failedList: ["svc-a", "svc-b"],
          succeededList: ["svc-c", "svc-d", "svc-e"],
          servicesList: ["svc-a", "svc-b", "svc-c", "svc-d", "svc-e"],
        },
        { trigger: { green_to_red: true } },
      );
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("Showcase deploy");
      expect(text).toContain("2/5 service(s) failed");
      expect(text).toContain("svc-a");
      expect(text).toContain("svc-b");
      expect(text).toContain("ok");
    });

    it("green_to_red total-failure branch renders servicesList (not partial)", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "deploy-result")!;
      const ctx = makeCtx(
        rule,
        {
          partial: false,
          failedCount: 3,
          totalCount: 3,
          failedList: ["svc-a", "svc-b", "svc-c"],
          succeededList: [],
          servicesList: ["svc-a", "svc-b", "svc-c"],
        },
        { trigger: { green_to_red: true } },
      );
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("FAILED — 3 service(s) targeted");
      expect(text).toContain("svc-a");
    });

    it("red_to_green branch renders recovered + firstFailureAt", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "deploy-result")!;
      const ctx = makeCtx(
        rule,
        {
          firstFailureAt: "2026-04-19T10:00:00Z",
        },
        { trigger: { red_to_green: true } },
      );
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("recovered");
      expect(text).toContain("2026-04-19T10:00:00Z");
    });

    it("cancelled_midmatrix branch renders mid-matrix cancellation message", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "deploy-result")!;
      const ctx = makeCtx(
        rule,
        {
          cancelled: true,
          cancelledMidMatrix: true,
        },
        { trigger: { cancelled_midmatrix: true } },
      );
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("cancelled mid-matrix");
      expect(text).toContain("newer run");
    });

    // R24 bucket-(a) item 3: gate_skipped branch must gate on the derived
    // trigger flag, not on `signal.gateSkipped`. Pre-fix the template used
    // `{{#signal.gateSkipped}}`, which (a) is asymmetric with every other
    // branch in this file (which keys off `trigger.*`), and (b) if a
    // `signal.gateSkipped:true` payload ever co-occurs with a
    // `green_to_red` state-machine transition, BOTH branches render
    // producing a double message. deriveSignalFlags already lifts
    // `signal.gateSkipped === true` into `trigger.gate_skipped`; the
    // template should key off that.
    it("gate_skipped branch renders when trigger.gate_skipped=true and signal.gateSkipped is absent", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "deploy-result")!;
      // Simulate alert-engine having set the derived trigger flag without
      // propagating a signal echo. Pre-fix this branch would NOT render.
      const ctx = makeCtx(rule, {}, { trigger: { gate_skipped: true } });
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).toContain("build matrix gated off");
    });

    it("gate_skipped branch does NOT render when only signal.gateSkipped=true (no trigger flag)", async () => {
      const { rules, renderer } = await loadRealRules();
      const rule = rules.find((r) => r.id === "deploy-result")!;
      // Inverse case: raw signal field set but the derived trigger flag
      // wasn't. Post-fix, the gate-skipped branch must NOT render since we
      // gate on `trigger.gate_skipped`, not `signal.gateSkipped`.
      const ctx = makeCtx(rule, { gateSkipped: true }, { trigger: {} });
      const text = (
        renderer.render({ text: rule.template!.text }, ctx).payload as {
          text: string;
        }
      ).text;
      expect(text).not.toContain("build matrix gated off");
    });
  });
});

describe("rule-loader: initial load emits rules.reload.failed on errors (R24 bucket-a)", () => {
  // R24 bucket-(a) item 4: watch() emits `rules.reload.failed` on per-file
  // errors so operators see a broken YAML pushed via SIGHUP-reload path.
  // The initial-load path (createRuleLoader(...).load()/loadWithErrors())
  // did NOT. Result: a service boots with a broken rule → the rule is
  // silently dropped from the active set. Operators only discover when an
  // incident fails to alert. Pull initial-load into symmetry with watch.
  it("emits rules.reload.failed on the bus when loadWithErrors() surfaces per-file errors", async () => {
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), "showcase-ops-initial-emit-"),
    );
    // One good rule.
    await fs.copyFile(
      path.join(FIXTURES, "valid", "_defaults.yml"),
      path.join(tmp, "_defaults.yml"),
    );
    await fs.copyFile(
      path.join(FIXTURES, "valid", "smoke-red-tick.yml"),
      path.join(tmp, "smoke-red-tick.yml"),
    );
    // One malformed rule (missing id, fails schema).
    await fs.copyFile(
      path.join(FIXTURES, "invalid", "missing-id.yml"),
      path.join(tmp, "missing-id.yml"),
    );

    const events: Array<{
      event: string;
      payload: { errors: { file: string; error: string }[] };
    }> = [];
    const bus = {
      emit(
        event: "rules.reload.failed",
        payload: { errors: { file: string; error: string }[] },
      ): void {
        events.push({ event, payload });
      },
    };

    const loader = createRuleLoader({ dir: tmp, logger, bus });
    const { rules, errors } = await loader.loadWithErrors();

    // Good rule still loads.
    expect(rules).toHaveLength(1);
    expect(rules[0]!.id).toBe("smoke-red-tick");
    // Bad rule surfaces via errors.
    expect(errors).toHaveLength(1);
    expect(errors[0]!.file).toBe("missing-id.yml");
    // Bus receives exactly one rules.reload.failed event with the malformed file.
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("rules.reload.failed");
    expect(events[0]!.payload.errors).toHaveLength(1);
    expect(events[0]!.payload.errors[0]!.file).toBe("missing-id.yml");
  });

  it("does NOT emit rules.reload.failed when initial load succeeds with zero errors", async () => {
    const events: Array<unknown> = [];
    const bus = {
      emit(
        _event: "rules.reload.failed",
        payload: { errors: { file: string; error: string }[] },
      ): void {
        events.push(payload);
      },
    };
    const loader = createRuleLoader({
      dir: path.join(FIXTURES, "valid"),
      logger,
      bus,
    });
    const { rules, errors } = await loader.loadWithErrors();
    expect(rules).toHaveLength(1);
    expect(errors).toEqual([]);
    // Clean load → no bus emit.
    expect(events).toEqual([]);
  });
});

describe("rule-loader: validateTripleBrace covers on_error.template.text (R21 bucket-a)", () => {
  // R21-a regression: validateTripleBrace previously only scanned
  // rule.template.text. A rule with `on_error.template: "{{{signal.x}}}"`
  // on a dimension where `x` wasn't slackSafe passed load validation and
  // rendered the raw value at runtime — a Slack mrkdwn-injection surface.
  // validateFilterNames already scanned both sources; this pulls
  // validateTripleBrace into symmetry with it.
  it("rejects on_error.template with triple-brace on an unsafe signal.* field", async () => {
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), "showcase-ops-onerr-tb-"),
    );
    await fs.writeFile(
      path.join(tmp, "bad-on-error.yml"),
      [
        "id: bad-on-error-triple-brace",
        'name: "bad on_error triple-brace"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "safe top-level {{ signal.slug }}"',
        "on_error:",
        "  template:",
        '    text: "{{{signal.arbitrary_unsafe_field}}}"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(rules).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error).toMatch(
      /triple-brace.*not marked slackSafe|triple-brace.*slackSafe/,
    );
  });
});

describe("rule-loader: rate_limit.window load-time validation (R28 bucket-a)", () => {
  // R27 slot 1 A1 regression: a rule with `conditions.rate_limit.window: "15"`
  // (missing unit) or `"1 hour"` (internal space) used to load cleanly. At
  // the first matching probe tick, `parseDuration` threw inside
  // `shouldSuppress`; the per-rule try/catch in `handleStatusChanged`
  // logged `alert-engine.rule-handler-failed` and swallowed the error, and
  // every subsequent tick repeated the same throw. The rule NEVER fired —
  // no Slack, no alert_state write. Load-time validation surfaces the bad
  // unit at boot with a clear "must be e.g. 15m/1h/3d" message.
  it("rejects a rule whose rate_limit.window is missing a unit suffix ('15')", async () => {
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-rlw-"));
    await fs.writeFile(
      path.join(tmp, "bad-rlwindow.yml"),
      [
        "id: bad-rlwindow",
        'name: "bad rate_limit.window"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "conditions:",
        "  rate_limit:",
        '    window: "15"', // missing unit
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(rules).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.file).toBe("bad-rlwindow.yml");
    expect(errors[0]!.error).toMatch(/rule-loader:/);
    expect(errors[0]!.error).toMatch(/rate_limit\.window/);
    expect(errors[0]!.error).toMatch(/15m|1h|3d/);
  });

  it("rejects a rule whose rate_limit.window contains an internal space ('1 hour')", async () => {
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-rlw2-"));
    await fs.writeFile(
      path.join(tmp, "bad-rlwindow-human.yml"),
      [
        "id: bad-rlwindow-human",
        'name: "bad rate_limit.window human"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "conditions:",
        "  rate_limit:",
        '    window: "1 hour"',
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(rules).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error).toMatch(/rate_limit\.window/);
  });

  it("accepts a well-formed rate_limit.window ('15m')", async () => {
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), "showcase-ops-rlw-ok-"),
    );
    await fs.writeFile(
      path.join(tmp, "good-rlwindow.yml"),
      [
        "id: good-rlwindow",
        'name: "good rate_limit.window"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "conditions:",
        "  rate_limit:",
        '    window: "15m"',
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.conditions.rate_limit?.window).toBe("15m");
  });

  it("accepts rate_limit: null (explicitly disabled — parseDuration is NOT called)", async () => {
    // Regression guard: null was already handled by loader but this pins
    // the contract — rate_limit:null must NOT reach parseDuration.
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), "showcase-ops-rlw-null-"),
    );
    await fs.writeFile(
      path.join(tmp, "null-rlwindow.yml"),
      [
        "id: null-rlwindow",
        'name: "null rate_limit"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "conditions:",
        "  rate_limit: null",
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
  });
});

describe("rule-loader: signal.filter.dimension load-time validation (R28 bucket-a)", () => {
  // R27 slot 5 B6 regression: R26 narrowed `SignalSchema.dimension` to the
  // closed DimensionEnum but missed the `filter.dimension` sub-field. A
  // filter clause with `dimension: "smokee"` passed validation and silently
  // never matched any probe key — same class of bug as R26 A1. Post-fix,
  // `FilterSchema.dimension` is also `DimensionEnum.optional()`.
  it("rejects a rule whose signal.filter.dimension is typoed ('smokee')", async () => {
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-fdim-"));
    await fs.writeFile(
      path.join(tmp, "bad-filter-dim.yml"),
      [
        "id: bad-filter-dim",
        'name: "bad filter.dimension"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "  filter:",
        "    dimension: smokee", // typo — should be "smoke"
        "triggers:",
        "  - green_to_red",
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(rules).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.file).toBe("bad-filter-dim.yml");
    expect(errors[0]!.error).toMatch(/rule-loader:/);
    expect(errors[0]!.error).toMatch(/smokee|dimension|enum/i);
  });

  it("accepts a well-formed signal.filter.dimension ('smoke')", async () => {
    const os = await import("node:os");
    const tmp = await fs.mkdtemp(
      path.join(os.tmpdir(), "showcase-ops-fdim-ok-"),
    );
    await fs.writeFile(
      path.join(tmp, "good-filter-dim.yml"),
      [
        "id: good-filter-dim",
        'name: "good filter.dimension"',
        'owner: "@oss"',
        "signal:",
        "  dimension: smoke",
        "  filter:",
        "    dimension: smoke",
        "triggers:",
        "  - green_to_red",
        "targets:",
        "  - kind: slack_webhook",
        "    webhook: oss_alerts",
        "template:",
        '  text: "x"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const loader = createRuleLoader({ dir: tmp, logger });
    const { rules, errors } = await loader.loadWithErrors();
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.signal.filter?.dimension).toBe("smoke");
  });
});

async function makeSingleFixtureDir(file: string): Promise<string> {
  const os = await import("node:os");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-rule-"));
  const src = path.join(FIXTURES, "invalid", file);
  const dest = path.join(tmp, file);
  await fs.copyFile(src, dest);
  return tmp;
}
