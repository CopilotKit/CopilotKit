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
    expect(r.targets).toHaveLength(2); // default + rule-level; deep-merge appends
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
        "  renderer: mustache",
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

async function makeSingleFixtureDir(file: string): Promise<string> {
  const os = await import("node:os");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "showcase-ops-rule-"));
  const src = path.join(FIXTURES, "invalid", file);
  const dest = path.join(tmp, file);
  await fs.copyFile(src, dest);
  return tmp;
}
