import { describe, it, expect } from "vitest";
import { createRuleLoader } from "./rule-loader.js";
import { logger } from "../logger.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

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

  it("rejects _defaults.yml with unknown `renderer` key (no longer silently dropped)", async () => {
    // Finding 14: the schema previously accepted `renderer` but loader
    // dropped it. Authors got silent no-ops. Removed from schema so a
    // stray declaration fails at load time with a clear message.
    const dir = await writeDir({
      "_defaults.yml": [
        "defaults:",
        "  severity: warn",
        "  renderer: mustache",
        "",
      ].join("\n"),
    });
    const loader = createRuleLoader({ dir, logger });
    await expect(loader.loadWithErrors()).rejects.toThrow(
      /Unrecognized key.*renderer/,
    );
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

async function makeSingleFixtureDir(file: string): Promise<string> {
  const os = await import("node:os");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-rule-"));
  const src = path.join(FIXTURES, "invalid", file);
  const dest = path.join(tmp, file);
  await fs.copyFile(src, dest);
  return tmp;
}
