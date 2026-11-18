import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// An oxlint override cannot set a category, so .oxlintrc.json lists every
// correctness and suspicious rule by name in the `packages/` source override
// (as error) and in the test override (as warn). This test reads the rules
// that the installed oxlint has and fails when the lists fall behind, for
// example after an oxlint upgrade adds a rule.

const REPO_ROOT = path.resolve(__dirname, "../..");
const CONFIG_PATH = path.join(REPO_ROOT, ".oxlintrc.json");
const GATED_CATEGORIES = new Set(["correctness", "suspicious"]);
const SOURCE_GLOB = "packages/**/*.{ts,tsx,mts,cts,js,mjs,cjs,jsx}";
const TEST_GLOB = "packages/**/__tests__/**";

type Severity = "off" | "warn" | "error";
type RuleSetting = Severity | [Severity, ...unknown[]];

interface Override {
  files: string[];
  rules?: Record<string, RuleSetting>;
}

interface OxlintConfig {
  plugins: string[];
  rules: Record<string, RuleSetting>;
  overrides: Override[];
}

interface OxlintRule {
  scope: string;
  value: string;
  category: string;
}

function readConfig() {
  const text = fs.readFileSync(CONFIG_PATH, "utf8");
  const { config, error } = ts.parseConfigFileTextToJson(CONFIG_PATH, text);
  if (error) throw new Error(`could not parse .oxlintrc.json`);
  // The shape is checked by the oxlint run in CI; this test only reads it.
  const parsed: OxlintConfig = config;
  return parsed;
}

function readRules() {
  const result = spawnSync(
    path.join(REPO_ROOT, "node_modules", ".bin", "oxlint"),
    ["--rules", "-f", "json"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  const rules: OxlintRule[] = JSON.parse(result.stdout);
  return rules;
}

function severityOf(setting: RuleSetting | undefined) {
  return Array.isArray(setting) ? setting[0] : setting;
}

function overrideFor(config: OxlintConfig, glob: string) {
  const override = config.overrides.find((entry) => entry.files.includes(glob));
  if (override === undefined) {
    throw new Error(`.oxlintrc.json has no override for ${glob}`);
  }
  return override.rules ?? {};
}

/** The gated rules, as `<plugin>/<rule>` names, that are not off at the top level. */
function gatedRuleNames(config: OxlintConfig, rules: readonly OxlintRule[]) {
  const plugins = new Set(["eslint", ...config.plugins]);
  return rules
    .filter(
      (rule) => GATED_CATEGORIES.has(rule.category) && plugins.has(rule.scope),
    )
    .map((rule) => `${rule.scope}/${rule.value}`)
    .filter((name) => severityOf(config.rules[name]) !== "off")
    .sort();
}

describe(".oxlintrc.json category rules", () => {
  const config = readConfig();
  const names = gatedRuleNames(config, readRules());

  it("finds the gated rules", () => {
    expect(names.length).toBeGreaterThan(100);
  });

  it("sets every correctness and suspicious rule to error for package source", () => {
    const source = overrideFor(config, SOURCE_GLOB);
    const notError = names.filter(
      (name) => severityOf(source[name]) !== "error",
    );
    expect(notError).toEqual([]);
  });

  it("does not gate those rules in package tests", () => {
    const tests = overrideFor(config, TEST_GLOB);
    const gated = names.filter((name) => {
      const severity = severityOf(tests[name]);
      return severity !== "warn" && severity !== "off";
    });
    expect(gated).toEqual([]);
  });
});
