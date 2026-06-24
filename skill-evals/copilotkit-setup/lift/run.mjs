#!/usr/bin/env node
// @ts-check
/**
 * Skill-lift comparison runner for the copilotkit-setup eval.
 *
 * WHAT THIS DOES
 *   Runs the skillgrade eval defined in ../eval.yaml TWICE against the same task:
 *     1. WITH the skill mounted (the normal config).
 *     2. WITHOUT the skill (see "the without-skill mechanism" below).
 *   It then parses both runs' persisted report JSONs, computes per-arm
 *   pass rate / mean reward / median duration / median commands / median tokens,
 *   computes the lift (withSkill - withoutSkill), prints a human-readable table,
 *   and writes a results JSON into ../results/<ISO-timestamp>.json.
 *
 *   lift.* = withSkill - withoutSkill, so:
 *     - a NEGATIVE durationMs / commands / tokens lift is GOOD (the skill made
 *       the agent faster / leaner);
 *     - a POSITIVE passRate lift is GOOD (the skill made the agent more correct).
 *
 * WHY SEVERAL TRIALS
 *   Efficiency deltas (duration, command count, token count) are noisy: a single
 *   trial's numbers swing wildly with model sampling and container scheduling. The
 *   numbers only mean something across several trials, so this defaults to 5 trials
 *   per arm (10 total agent runs). Override with --trials=N or SKILL_EVAL_TRIALS=N
 *   when you want a tighter or cheaper estimate.
 *
 * THE WITHOUT-SKILL MECHANISM
 *   skillgrade has NO --no-skill flag. It always mounts the skill named in
 *   eval.yaml's `skill:` field. Its analytics engine
 *   (node_modules/skillgrade/dist/analytics/engine.js) classifies a report as
 *   "without skill" purely by `report.skills_used.length === 0`, and skills_used
 *   is `skillsPaths.map(basename)` (see dist/evalRunner.js). skillsPaths comes out
 *   EMPTY when the `skill:` path does not resolve to an existing directory (see the
 *   skill-resolution block in dist/commands/run.js: a missing path logs a warning
 *   and leaves skillsPaths = []).
 *
 *   So the no-skill arm runs skillgrade against a *temporary copy of the eval dir*
 *   whose eval.yaml points `skill:` at a path that does not exist. skillgrade's
 *   skill-resolution `fs.stat`s that path, gets null, prints a one-line
 *   "skill path not found" warning, and leaves skillsPaths = [] — so skills_used
 *   comes out empty and the analytics engine classifies the report as "without
 *   skill". (Pointing at an *empty existing directory* does NOT work: skillgrade
 *   would still set skillsPaths = [thatDir] and skills_used = ["..."], which
 *   classifies as with-skill. The path must be MISSING.)
 *
 *   skillgrade reads eval.yaml and resolves every other file reference (workspace
 *   `src`, grader `run`, rubric `rubric`) relative to its working directory (cwd),
 *   so the temp dir symlinks every sibling of eval.yaml (graders/, rubric.md,
 *   workspace/, ...) back to the real ones. The agent therefore gets an identical
 *   task and graders, just no skill mounted. This is the least-hacky option: it
 *   touches nothing in the real eval dir and relies only on skillgrade's documented
 *   skill-resolution fallback and its own "empty skills_used = without skill"
 *   convention.
 *
 * AUTH / PREREQS (fail loud, no silent fallbacks)
 *   - Docker must be installed and its daemon reachable (provider: docker).
 *   - An agent LLM key must be present: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN,
 *     either in the environment or in a .env next to eval.yaml.
 *   - The llm_rubric trace judge additionally needs a real ANTHROPIC_API_KEY (OAuth
 *     subscription tokens cannot call the messages API). We warn (do not hard-fail)
 *     if only an OAuth token is present, because a deterministic-only run is still
 *     useful and skillgrade will surface the rubric failure itself.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .../skill-evals/copilotkit-setup/lift/run.mjs -> eval dir is the parent of lift/
const EVAL_DIR = path.resolve(__dirname, "..");
const RESULTS_DIR = path.join(EVAL_DIR, "results");
const SKILL_NAME = "copilotkit-setup";

/** Print and exit non-zero with a clear, actionable message. */
function die(message) {
  console.error(`\n[lift] ERROR: ${message}\n`);
  process.exit(1);
}

/** Resolve the trial count: --trials=N flag > SKILL_EVAL_TRIALS env > default 5. */
function resolveTrials() {
  const flag = process.argv.slice(2).find((a) => a.startsWith("--trials="));
  const raw = flag ? flag.split("=")[1] : process.env.SKILL_EVAL_TRIALS;
  if (raw === undefined) return 5;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    die(`invalid trial count "${raw}" (must be a positive integer)`);
  }
  return n;
}

/** Read an .env file into a flat key/value object (best effort, KEY=VALUE lines). */
function readEnvFile(file) {
  if (!existsSync(file)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Verify Docker is installed and its daemon is reachable. Fail loud otherwise. */
function preflightDocker() {
  const probe = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (probe.error && probe.error.code === "ENOENT") {
    die(
      "Docker is not installed (the `docker` command was not found). " +
        "skillgrade runs each trial in a container (provider: docker). " +
        "Install Docker Desktop / Engine and try again.",
    );
  }
  if (probe.status !== 0) {
    die(
      "Docker is installed but the daemon is not reachable (`docker info` failed). " +
        "Start Docker and try again.",
    );
  }
}

/**
 * Verify an agent LLM key is available (env or .env). Fail loud otherwise.
 * Returns { rubricCapable }: whether a key that can drive the llm_rubric trace
 * judge is present. The agent (Claude Code) runs on either ANTHROPIC_API_KEY or
 * CLAUDE_CODE_OAUTH_TOKEN, but the rubric grader calls the messages API directly
 * (the default grader_provider is `anthropic`), which OAuth tokens cannot do.
 * When only an OAuth token is present we run deterministic-only (see main) so a
 * subscription user gets a clean, key-free run instead of a polluted reward from
 * a rubric grader that scores 0 for "missing key".
 */
function preflightAuth() {
  const fileEnv = readEnvFile(path.join(EVAL_DIR, ".env"));
  const val = (k) => (process.env[k] || fileEnv[k] || "").trim();
  const has = (k) => !!val(k);
  // Validate token shape BEFORE a run. A token captured from the interactive
  // `claude setup-token` via $(...) is polluted with terminal escape codes and
  // produces an opaque in-container "API Error 400" 20 minutes later; catch it
  // here. Control chars (ESC = \x1b) or internal whitespace mean it is not a
  // clean token. Expected prefixes: sk-ant-oat (OAuth), sk-ant- (Console key).
  const malformed = (name, prefix) => {
    const v = val(name);
    if (!v) return null;
    if (/\s/.test(v) || v.split("").some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
      return `${name} contains whitespace or control characters`;
    if (!v.startsWith(prefix))
      return `${name} does not start with "${prefix}"`;
    return null;
  };
  const badToken =
    malformed("CLAUDE_CODE_OAUTH_TOKEN", "sk-ant-oat") ||
    malformed("ANTHROPIC_API_KEY", "sk-ant-");
  if (badToken) {
    die(
      `${badToken}. Your token looks malformed. If you ran ` +
        "`claude setup-token`, copy ONLY the printed sk-ant-oat... value into the " +
        `.env next to ${path.join(EVAL_DIR, "eval.yaml")} — do NOT capture its ` +
        "output with $(claude setup-token), which slurps the interactive TUI's " +
        "escape codes instead of the token.",
    );
  }
  const hasAnthropic = has("ANTHROPIC_API_KEY");
  const hasOauth = has("CLAUDE_CODE_OAUTH_TOKEN");
  if (!hasAnthropic && !hasOauth) {
    die(
      "No agent LLM key found. Set ANTHROPIC_API_KEY (Console billing) or " +
        "CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`, subscription billing) " +
        `in the environment or in a .env next to ${path.join(EVAL_DIR, "eval.yaml")}.`,
    );
  }
  if (!hasAnthropic && hasOauth) {
    console.warn(
      "[lift] only CLAUDE_CODE_OAUTH_TOKEN is set: the agent runs on your " +
        "subscription, but the llm_rubric trace judge needs a real ANTHROPIC_API_KEY " +
        "(OAuth tokens cannot call the messages API). Running deterministic-only — " +
        "the build/type-check gate and the duration/commands/tokens lift still apply; " +
        "the trace judge is skipped. Add ANTHROPIC_API_KEY to include it.",
    );
  }
  return { rubricCapable: hasAnthropic };
}

/**
 * Build a temporary eval dir for the no-skill arm: an eval.yaml whose `skill:`
 * points at a path that does NOT exist (so skillgrade resolves no skill), with
 * every other sibling of the real eval.yaml symlinked in so file references
 * (workspace/graders/rubric) still resolve. Returns the temp dir path.
 */
function makeNoSkillEvalDir() {
  const tmpRoot = mkdtempSync(path.join(tmpdir(), "skillgrade-noskill-"));
  // Symlink every sibling of eval.yaml (workspace/, graders/, rubric.md, .env, ...)
  // EXCEPT eval.yaml itself (we write a modified copy) and results/ (irrelevant,
  // and skipping it avoids dragging the gitignored output dir into the temp tree).
  for (const entry of readdirSync(EVAL_DIR)) {
    if (entry === "eval.yaml" || entry === "results") continue;
    symlinkSync(path.join(EVAL_DIR, entry), path.join(tmpRoot, entry));
  }
  // Rewrite the `skill:` line in eval.yaml to point at a path that does not exist.
  // skillgrade fs.stats it, gets null, warns "skill path not found", and leaves
  // skillsPaths empty -> skills_used empty -> classified "without skill". (See the
  // header comment: an empty *existing* dir would NOT work.) The original value is
  // a single relative path on its own line ("skill: ../../skills/copilotkit-setup").
  const original = readFileSync(path.join(EVAL_DIR, "eval.yaml"), "utf8");
  const lines = original.split("\n");
  let replaced = false;
  const rewritten = lines
    .map((line) => {
      if (/^\s*skill\s*:/.test(line)) {
        replaced = true;
        return "skill: ./.no-skill-sentinel-does-not-exist";
      }
      return line;
    })
    .join("\n");
  if (!replaced) {
    die(
      "could not find a top-level `skill:` line in eval.yaml to redirect for the " +
        "no-skill arm; the eval.yaml format may have changed.",
    );
  }
  writeFileSync(path.join(tmpRoot, "eval.yaml"), rewritten);
  return tmpRoot;
}

/** Resolve the skillgrade CLI entrypoint from node_modules. */
function resolveSkillgradeBin() {
  const bin = path.resolve(
    EVAL_DIR,
    "../../node_modules/skillgrade/bin/skillgrade.js",
  );
  if (!existsSync(bin)) {
    die(
      `skillgrade CLI not found at ${bin}. Run \`pnpm install\` (skillgrade is a ` +
        "root devDependency pinned to 0.1.5).",
    );
  }
  return bin;
}

/**
 * Run one skillgrade arm. cwd is the eval dir (real or the no-skill temp copy).
 * Reports land in <output>/<basename(cwd)>/results/. Returns that results dir.
 */
function runArm({ label, cwd, outputDir, trials, bin, graderFilter }) {
  console.log(`\n[lift] ===== running ${label} arm (${trials} trials) =====`);
  const args = [bin, `--trials=${trials}`, `--output=${outputDir}`];
  // Restrict to deterministic grading when the rubric can't run (OAuth-only).
  // skillgrade renormalizes the reward over the graders that actually ran, so a
  // deterministic-only reward is still a clean 0..1. Both arms MUST use the same
  // filter or the lift comparison is apples-to-oranges.
  if (graderFilter) args.push(`--grader=${graderFilter}`);
  const res = spawnSync("node", args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, NO_COLOR: process.env.NO_COLOR ?? "1" },
  });
  if (res.error) {
    die(
      `failed to launch skillgrade for the ${label} arm: ${res.error.message}`,
    );
  }
  // skillgrade returns non-zero only in --ci mode (not used here); a crash before
  // reports are written is caught by the report-parsing step below.
  const resultsDir = path.join(outputDir, path.basename(cwd), "results");
  if (!existsSync(resultsDir)) {
    die(
      `${label} arm produced no results directory (${resultsDir}). The skillgrade ` +
        "run likely failed before writing any report; see its output above.",
    );
  }
  return resultsDir;
}

/**
 * Load every per-task report JSON from a results dir and flatten all trials.
 * Validates the shape we depend on and fails loud on anything unexpected.
 * Returns { trials: TrialResult[], skillsUsed: string[] }.
 */
function loadArmTrials(resultsDir, label) {
  const files = readdirSync(resultsDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    die(`${label} arm wrote no report JSON into ${resultsDir}.`);
  }
  /** @type {any[]} */
  const trials = [];
  /** @type {Set<string>} */
  const skillsUsed = new Set();
  for (const file of files) {
    const full = path.join(resultsDir, file);
    let report;
    try {
      report = JSON.parse(readFileSync(full, "utf8"));
    } catch (err) {
      die(`could not parse ${label} report ${full}: ${err.message}`);
    }
    if (!Array.isArray(report.trials) || !Array.isArray(report.skills_used)) {
      die(
        `${label} report ${full} is missing the expected \`trials\`/\`skills_used\` ` +
          "arrays; skillgrade's report shape may have changed.",
      );
    }
    for (const s of report.skills_used) skillsUsed.add(s);
    for (const t of report.trials) {
      for (const field of [
        "reward",
        "duration_ms",
        "n_commands",
        "input_tokens",
        "output_tokens",
      ]) {
        if (typeof t[field] !== "number") {
          die(
            `${label} report ${full} has a trial missing numeric \`${field}\`; ` +
              "skillgrade's trial shape may have changed.",
          );
        }
      }
      trials.push(t);
    }
  }
  return { trials, skillsUsed: [...skillsUsed] };
}

/**
 * Detect agent-execution failures in an arm's trials. skillgrade does NOT fail
 * when the agent itself errors: it records the failed `claude -p` command and
 * lets the grader score the (untouched) workspace, which silently produces a
 * no-op "pass" (e.g. a bare fixture that still type-checks). That is exactly the
 * false "no lift" trap — so we scan the session log for the agent command's
 * non-zero exit (or an "API Error" agent_result) and surface it. Returns
 * { failed, total, firstError }.
 */
function detectAgentFailures(trials) {
  let failed = 0;
  let firstError = "";
  for (const t of trials) {
    const log = t.session_log || t.sessionLog || [];
    const agentCmd = log.find(
      (e) =>
        e.type === "command" &&
        typeof e.command === "string" &&
        e.command.includes("claude -p"),
    );
    const result = log.find((e) => e.type === "agent_result");
    const cmdFailed = agentCmd && agentCmd.exitCode !== 0;
    const apiError =
      result && /API Error|^error/im.test(String(result.output || ""));
    if (cmdFailed || apiError) {
      failed++;
      if (!firstError) {
        firstError = String(
          (agentCmd && (agentCmd.stdout || agentCmd.stderr)) ||
            (result && result.output) ||
            "unknown agent error",
        ).trim();
      }
    }
  }
  return { failed, total: trials.length, firstError };
}

/** Median of a numeric array (rounded to an integer; lift metrics are counts/ms). */
function median(nums) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(m);
}

/** Compute per-arm aggregate metrics from a flat list of trials. */
function summarize(trials) {
  const n = trials.length;
  const passes = trials.filter((t) => t.reward >= 0.5).length;
  const meanReward = n > 0 ? trials.reduce((s, t) => s + t.reward, 0) / n : 0;
  return {
    passRate: n > 0 ? passes / n : 0,
    meanReward: round4(meanReward),
    medianDurationMs: median(trials.map((t) => t.duration_ms)),
    medianCommands: median(trials.map((t) => t.n_commands)),
    medianTokens: median(trials.map((t) => t.input_tokens + t.output_tokens)),
  };
}

function round4(x) {
  return Math.round(x * 1e4) / 1e4;
}

/** Format an ms value as a compact seconds string for the table. */
function fmtMs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Print the with/without/delta comparison table. */
function printTable(withSkill, withoutSkill, lift, trials) {
  const rows = [
    ["metric", "with skill", "without skill", "lift (with - without)"],
    [
      "pass rate",
      `${(withSkill.passRate * 100).toFixed(1)}%`,
      `${(withoutSkill.passRate * 100).toFixed(1)}%`,
      `${lift.passRate >= 0 ? "+" : ""}${(lift.passRate * 100).toFixed(1)}pp`,
    ],
    [
      "mean reward",
      withSkill.meanReward.toFixed(3),
      withoutSkill.meanReward.toFixed(3),
      `${lift.meanReward >= 0 ? "+" : ""}${lift.meanReward.toFixed(3)}`,
    ],
    [
      "median duration",
      fmtMs(withSkill.medianDurationMs),
      fmtMs(withoutSkill.medianDurationMs),
      `${lift.durationMs <= 0 ? "" : "+"}${fmtMs(lift.durationMs)}`,
    ],
    [
      "median commands",
      String(withSkill.medianCommands),
      String(withoutSkill.medianCommands),
      `${lift.commands >= 0 ? "+" : ""}${lift.commands}`,
    ],
    [
      "median tokens",
      String(withSkill.medianTokens),
      String(withoutSkill.medianTokens),
      `${lift.tokens >= 0 ? "+" : ""}${lift.tokens}`,
    ],
  ];
  const widths = rows[0].map((_, c) =>
    Math.max(...rows.map((r) => String(r[c]).length)),
  );
  const sep = widths.map((w) => "-".repeat(w)).join("-+-");
  console.log(`\n[lift] skill: ${SKILL_NAME}   trials/arm: ${trials}\n`);
  rows.forEach((row, i) => {
    console.log(
      row.map((cell, c) => String(cell).padEnd(widths[c])).join(" | "),
    );
    if (i === 0) console.log(sep);
  });
  console.log(
    "\n[lift] reading the lift column: NEGATIVE duration/commands/tokens is GOOD " +
      "(skill made the agent leaner); POSITIVE pass rate / mean reward is GOOD.",
  );
}

function main() {
  const trials = resolveTrials();

  preflightDocker();
  const { rubricCapable } = preflightAuth();
  // No real rubric key -> deterministic-only on BOTH arms (keeps lift comparable).
  const graderFilter = rubricCapable ? null : "deterministic";

  const bin = resolveSkillgradeBin();
  const runRoot = mkdtempSync(path.join(tmpdir(), "skillgrade-lift-"));
  const withOutputDir = path.join(runRoot, "with");
  const withoutOutputDir = path.join(runRoot, "without");

  // WITH-skill arm: real eval dir as cwd, normal config.
  const withResultsDir = runArm({
    label: "WITH-skill",
    cwd: EVAL_DIR,
    outputDir: withOutputDir,
    trials,
    bin,
    graderFilter,
  });

  // WITHOUT-skill arm: temp eval dir pointing `skill:` at an empty directory.
  const noSkillDir = makeNoSkillEvalDir();
  const withoutResultsDir = runArm({
    label: "WITHOUT-skill",
    cwd: noSkillDir,
    outputDir: withoutOutputDir,
    trials,
    bin,
    graderFilter,
  });

  const withArm = loadArmTrials(withResultsDir, "WITH-skill");
  const withoutArm = loadArmTrials(withoutResultsDir, "WITHOUT-skill");

  // Fail loud if the agent never actually ran. skillgrade scores an untouched
  // workspace as a no-op "pass", so a broken agent looks like "no lift" rather
  // than an error — the trap this whole eval would otherwise walk into.
  for (const [label, arm] of [
    ["WITH-skill", withArm],
    ["WITHOUT-skill", withoutArm],
  ]) {
    const { failed, total, firstError } = detectAgentFailures(arm.trials);
    if (total > 0 && failed === total) {
      die(
        `${label} arm: the agent failed to execute in ALL ${total} trial(s), so the ` +
          'eval graded an untouched workspace — any "lift" here is meaningless. ' +
          `First agent error: ${firstError.slice(0, 300)}\n` +
          "Most common cause: a malformed agent token (an in-container `API Error " +
          "400` usually means the Authorization header is garbage). If you used " +
          "CLAUDE_CODE_OAUTH_TOKEN, make sure .env holds ONLY the sk-ant-oat... " +
          "string from `claude setup-token` — not the output of $(claude setup-token).",
      );
    }
    if (failed > 0) {
      console.warn(
        `[lift] WARNING: ${label} arm had ${failed}/${total} agent-execution ` +
          "failures; the medians below are skewed by no-op trials.",
      );
    }
  }

  // Sanity: the analytics convention is skills_used.length>0 == with-skill. Verify
  // each arm landed on the expected side so a misconfigured run fails loud.
  if (withArm.skillsUsed.length === 0) {
    die(
      "the WITH-skill arm reported an EMPTY skills_used — the skill did not mount. " +
        "Check eval.yaml's `skill:` path.",
    );
  }
  if (withoutArm.skillsUsed.length !== 0) {
    die(
      `the WITHOUT-skill arm reported skills_used=[${withoutArm.skillsUsed.join(
        ", ",
      )}] — the no-skill mechanism failed to suppress the skill.`,
    );
  }

  const withSkill = summarize(withArm.trials);
  const withoutSkill = summarize(withoutArm.trials);
  const lift = {
    passRate: round4(withSkill.passRate - withoutSkill.passRate),
    meanReward: round4(withSkill.meanReward - withoutSkill.meanReward),
    durationMs: withSkill.medianDurationMs - withoutSkill.medianDurationMs,
    commands: withSkill.medianCommands - withoutSkill.medianCommands,
    tokens: withSkill.medianTokens - withoutSkill.medianTokens,
  };

  printTable(withSkill, withoutSkill, lift, trials);

  const result = {
    timestamp: new Date().toISOString(),
    skill: SKILL_NAME,
    trials,
    withSkill: {
      passRate: round4(withSkill.passRate),
      meanReward: withSkill.meanReward,
      medianDurationMs: withSkill.medianDurationMs,
      medianCommands: withSkill.medianCommands,
      medianTokens: withSkill.medianTokens,
    },
    withoutSkill: {
      passRate: round4(withoutSkill.passRate),
      meanReward: withoutSkill.meanReward,
      medianDurationMs: withoutSkill.medianDurationMs,
      medianCommands: withoutSkill.medianCommands,
      medianTokens: withoutSkill.medianTokens,
    },
    lift: {
      passRate: lift.passRate,
      durationMs: lift.durationMs,
      commands: lift.commands,
      tokens: lift.tokens,
    },
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = path.join(
    RESULTS_DIR,
    `${result.timestamp.replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\n[lift] wrote results: ${outFile}\n`);
}

// Exported for the lift-math self-test (test/lift.test.mjs); the CLI entrypoint
// only runs main() when this file is executed directly.
export { loadArmTrials, summarize, median, round4 };

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
