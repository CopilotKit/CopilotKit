#!/usr/bin/env node
/**
 * Skill-lift comparison harness for the copilotkit-setup skill.
 *
 * WHAT THIS DOES
 *   Runs the same task TWICE against a fresh container each trial:
 *     1. WITH the skill mounted at /workspace/.claude/skills/copilotkit-setup
 *     2. WITHOUT it (the dir is simply absent)
 *   then diffs the two arms. The agent is real Claude Code (`claude -p`), invoked
 *   with --output-format stream-json so we read REAL efficiency signal off the
 *   result event — num_turns, usage tokens, duration_ms, total_cost_usd — instead
 *   of estimates. The with/without difference is literally "is the skill dir
 *   present", a `docker cp` toggle, not a hack.
 *
 *   lift.* = withSkill - withoutSkill, so:
 *     - NEGATIVE turns / tokens / durationMs / costUsd is GOOD (skill = leaner);
 *     - POSITIVE passRate is GOOD (skill = more correct).
 *
 * SCORING (per trial)
 *   - GATE (always): graders/check.mjs builds / type-checks the agent's output in
 *     the container and returns a deterministic [0,1] score. This is THE score.
 *   - JUDGE (optional): when an OpenAI or Anthropic key is present, an LLM reads
 *     the agent's stream-json transcript and scores "how directly did it reach the
 *     canonical v2 surface" against rubric.md. Folded in at gate 0.60 / judge 0.40.
 *     Absent key -> deterministic-only (rubricRan:false), and the run stays
 *     key-free on a `claude setup-token` subscription.
 *
 * AUTH
 *   - Agent (Claude Code): CLAUDE_CODE_OAUTH_TOKEN (subscription) or
 *     ANTHROPIC_API_KEY (Console). Either runs the agent.
 *   - Judge: OPENAI_API_KEY (preferred when set) or ANTHROPIC_API_KEY. OAuth
 *     subscription tokens cannot drive the judge — that is why the judge is
 *     optional and auto-skipped on an OAuth-only setup.
 *   Keys come from the environment or a .env next to this eval's eval-dir root.
 *
 * PREREQS: Docker installed and its daemon reachable.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .../skill-evals/copilotkit-setup/lift/run.ts -> eval dir is the parent of lift/.
const EVAL_DIR = path.resolve(__dirname, "..");
const RESULTS_DIR = path.join(EVAL_DIR, "results");
const SKILL_NAME = "copilotkit-setup";
const SKILL_DIR = path.resolve(EVAL_DIR, "../../skills", SKILL_NAME);
const IMAGE = "copilotkit-setup-eval";
const CONTAINER_SKILL_DIR = `/workspace/.claude/skills/${SKILL_NAME}`;

const AGENT_TIMEOUT_MS = 15 * 60 * 1000; // 900s, matches the old task timeout.
const GATE_TIMEOUT_MS = 5 * 60 * 1000;

type ArmLabel = "WITH-skill" | "WITHOUT-skill";

interface Trial {
  ok: boolean; // did the agent run to a successful result event
  gateScore: number;
  judgeScore: number | null;
  reward: number;
  durationMs: number;
  numTurns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  error?: string;
}

interface ArmSummary {
  passRate: number;
  meanReward: number;
  medianDurationMs: number;
  medianTurns: number;
  medianTokens: number;
  medianCostUsd: number;
}

/** Print a clear, actionable message and exit non-zero. */
function die(message: string): never {
  console.error(`\n[lift] ERROR: ${message}\n`);
  process.exit(1);
}

/** Resolve trial count: --trials=N flag > SKILL_EVAL_TRIALS env > default 5. */
function resolveTrials(): number {
  const flag = process.argv.slice(2).find((a) => a.startsWith("--trials="));
  const raw = flag ? flag.split("=")[1] : process.env.SKILL_EVAL_TRIALS;
  if (raw === undefined) return 5;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    die(`invalid trial count "${raw}" (must be a positive integer)`);
  }
  return n;
}

/** Read a .env file into a flat key/value map (best effort, KEY=VALUE lines). */
function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
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

/** Verify Docker is installed and its daemon is reachable. */
function preflightDocker(): void {
  const probe = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (probe.error && (probe.error as NodeJS.ErrnoException).code === "ENOENT") {
    die(
      "Docker is not installed (the `docker` command was not found). Each trial " +
        "runs in a container. Install Docker Desktop / Engine and try again.",
    );
  }
  if (probe.status !== 0) {
    die(
      "Docker is installed but the daemon is not reachable (`docker info` failed). " +
        "Start Docker and try again.",
    );
  }
}

interface JudgeConfig {
  provider: "openai" | "anthropic";
  key: string;
  model: string;
}

interface Auth {
  /** Env pairs to forward to the in-container agent (the key it authenticates with). */
  agentEnv: Record<string, string>;
  /** Judge config, or null when no judge-capable key is present. */
  judge: JudgeConfig | null;
}

/**
 * Resolve agent + judge auth from env and the eval-dir .env. Fail loud if no
 * agent key is present. The judge is optional.
 */
function preflightAuth(): Auth {
  const fileEnv = readEnvFile(path.join(EVAL_DIR, ".env"));
  const val = (k: string) => (process.env[k] || fileEnv[k] || "").trim();

  // Reject tokens polluted by $(claude setup-token) — control chars / whitespace —
  // before a 15-minute run dies on an opaque in-container "API Error 400".
  const malformed = (name: string, prefix: string): string | null => {
    const v = val(name);
    if (!v) return null;
    if (
      /\s/.test(v) ||
      v.split("").some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    ) {
      return `${name} contains whitespace or control characters`;
    }
    if (!v.startsWith(prefix)) return `${name} does not start with "${prefix}"`;
    return null;
  };
  const badToken =
    malformed("CLAUDE_CODE_OAUTH_TOKEN", "sk-ant-oat") ||
    malformed("ANTHROPIC_API_KEY", "sk-ant-");
  if (badToken) {
    die(
      `${badToken}. If you ran \`claude setup-token\`, copy ONLY the printed ` +
        `sk-ant-oat... value into the .env next to ${EVAL_DIR}/eval — do NOT ` +
        "capture it with $(claude setup-token), which slurps the TUI's escape codes.",
    );
  }

  const oauth = val("CLAUDE_CODE_OAUTH_TOKEN");
  const anthropic = val("ANTHROPIC_API_KEY");
  const openai = val("OPENAI_API_KEY");

  // Agent: prefer the OAuth subscription token, fall back to a Console key.
  const agentEnv: Record<string, string> = {};
  if (oauth) agentEnv.CLAUDE_CODE_OAUTH_TOKEN = oauth;
  else if (anthropic) agentEnv.ANTHROPIC_API_KEY = anthropic;
  else {
    die(
      "No agent LLM key found. Set CLAUDE_CODE_OAUTH_TOKEN (from `claude " +
        "setup-token`, subscription) or ANTHROPIC_API_KEY (Console) in the " +
        `environment or in a .env next to ${EVAL_DIR}/eval.`,
    );
  }

  // Judge: JUDGE_PROVIDER forces a provider; otherwise prefer OpenAI when its key
  // is present (the user asked for OpenAI support), else fall back to Anthropic.
  const forced = val("JUDGE_PROVIDER").toLowerCase();
  let judge: JudgeConfig | null = null;
  const useOpenai =
    openai && (forced === "openai" || (!forced && Boolean(openai)));
  const useAnthropic = anthropic && (forced === "anthropic" || !forced);
  if (useOpenai) {
    judge = {
      provider: "openai",
      key: openai,
      model: val("OPENAI_MODEL") || "gpt-5.5",
    };
  } else if (useAnthropic) {
    judge = {
      provider: "anthropic",
      key: anthropic,
      model: val("ANTHROPIC_GRADER_MODEL") || "claude-haiku-4-5-20251001",
    };
  }

  if (!judge) {
    console.warn(
      "[lift] no judge-capable key (OPENAI_API_KEY or ANTHROPIC_API_KEY) — running " +
        "DETERMINISTIC-ONLY: the build/type-check gate and the real " +
        "turns/tokens/duration/cost lift still apply; the trace judge is skipped. " +
        "Add OPENAI_API_KEY (or ANTHROPIC_API_KEY) to include it.",
    );
  } else {
    console.warn(`[lift] judge: ${judge.provider} (${judge.model}).`);
  }
  return { agentEnv, judge };
}

/** Build the eval image once. Fail loud on build error. */
function buildImage(): void {
  if (!existsSync(SKILL_DIR)) {
    die(`skill under test not found at ${SKILL_DIR}.`);
  }
  console.log(`\n[lift] building image ${IMAGE} (once)...`);
  const res = spawnSync(
    "docker",
    ["build", "-t", IMAGE, "-f", path.join(EVAL_DIR, "Dockerfile"), EVAL_DIR],
    { stdio: "inherit" },
  );
  if (res.status !== 0) die("docker build failed (see output above).");
}

/** Run a docker subcommand, capturing stdout. Returns {status, stdout, stderr}. */
function docker(
  args: string[],
  opts: { timeoutMs?: number; env?: Record<string, string> } = {},
) {
  const res = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: opts.timeoutMs,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  return {
    status: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    timedOut: res.signal === "SIGTERM" && Boolean(opts.timeoutMs),
  };
}

interface AgentRun {
  result: Record<string, any> | null;
  transcript: string;
}

/** Parse stream-json (JSONL) into the final result event + a judge transcript. */
function parseStreamJson(stdout: string): AgentRun {
  let result: Record<string, any> | null = null;
  const lines: string[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line || line[0] !== "{") continue;
    let evt: any;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.type === "result") {
      result = evt;
      continue;
    }
    if (evt.type === "assistant" && evt.message?.content) {
      for (const block of evt.message.content) {
        if (block.type === "text" && block.text?.trim()) {
          lines.push(`ASSISTANT: ${truncate(block.text.trim(), 500)}`);
        } else if (block.type === "tool_use") {
          const input = JSON.stringify(block.input ?? {});
          lines.push(`TOOL_USE ${block.name}: ${truncate(input, 400)}`);
        }
      }
    } else if (evt.type === "user" && evt.message?.content) {
      for (const block of evt.message.content) {
        if (block.type === "tool_result") {
          const c = block.content;
          const text =
            typeof c === "string"
              ? c
              : Array.isArray(c)
                ? c.map((x: any) => x.text || "").join("")
                : "";
          lines.push(
            `TOOL_RESULT${block.is_error ? " (error)" : ""}: ${truncate(text, 300)}`,
          );
        }
      }
    }
  }
  // Cap the transcript so judge token cost stays bounded on long traces.
  const transcript = lines.join("\n").slice(0, 24000);
  return { result, transcript };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Run one trial in a fresh container. Returns its parsed agent run + gate score. */
function runTrial(
  withSkill: boolean,
  auth: Auth,
): { run: AgentRun; gate: { score: number } | null } {
  const created = docker([
    "run",
    "-d",
    "-w",
    "/workspace",
    IMAGE,
    "sleep",
    "infinity",
  ]);
  if (created.status !== 0) {
    die(`failed to start a container: ${created.stderr.trim()}`);
  }
  const cid = created.stdout.trim();
  try {
    if (withSkill) {
      docker(["exec", cid, "mkdir", "-p", CONTAINER_SKILL_DIR]);
      const cp = docker([
        "cp",
        `${SKILL_DIR}/.`,
        `${cid}:${CONTAINER_SKILL_DIR}`,
      ]);
      if (cp.status !== 0) {
        die(`failed to copy the skill into the container: ${cp.stderr.trim()}`);
      }
    }

    // Run the agent. IS_SANDBOX=1 lets --dangerously-skip-permissions run as root
    // (the container IS the sandbox). The instruction is baked at /eval-tools.
    const envFlags: string[] = ["-e", "IS_SANDBOX=1"];
    for (const [k, v] of Object.entries(auth.agentEnv)) {
      envFlags.push("-e", `${k}=${v}`);
    }
    const agent = docker(
      [
        "exec",
        ...envFlags,
        cid,
        "bash",
        "-lc",
        'claude -p "$(cat /eval-tools/instruction.md)" ' +
          "--output-format stream-json --verbose --dangerously-skip-permissions",
      ],
      { timeoutMs: AGENT_TIMEOUT_MS },
    );
    const run = parseStreamJson(agent.stdout);
    if (agent.timedOut) {
      run.result = run.result ?? { is_error: true, subtype: "timeout" };
    }

    // Gate: build / type-check the agent's output.
    const graded = docker(["exec", cid, "node", "/eval-tools/check.mjs"], {
      timeoutMs: GATE_TIMEOUT_MS,
    });
    let gate: { score: number } | null = null;
    const m = graded.stdout.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        gate = JSON.parse(m[0]);
      } catch {
        gate = null;
      }
    }
    return { run, gate };
  } finally {
    docker(["rm", "-f", cid]);
  }
}

/** Score the agent's transcript against rubric.md via the configured judge. */
async function judgeTranscript(
  transcript: string,
  judge: JudgeConfig,
  rubric: string,
): Promise<number | null> {
  const user =
    `${transcript}\n\n---\nScore the trace quality on [0, 1] per the rubric. ` +
    "Respond with ONLY a single number between 0 and 1.";
  try {
    let text: string;
    if (judge.provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${judge.key}`,
        },
        // No `temperature`: GPT-5-family models reject any non-default value
        // ("temperature does not support 0"), and the default is fine for a
        // single 0-1 directness score.
        body: JSON.stringify({
          model: judge.model,
          messages: [
            { role: "system", content: rubric },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(
          `[lift] judge (openai) HTTP ${res.status}: ${truncate(body, 300)} — skipping this trial's judge.`,
        );
        return null;
      }
      const data: any = await res.json();
      text = data.choices?.[0]?.message?.content ?? "";
    } else {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": judge.key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: judge.model,
          max_tokens: 64,
          system: rubric,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(
          `[lift] judge (anthropic) HTTP ${res.status}: ${truncate(body, 300)} — skipping this trial's judge.`,
        );
        return null;
      }
      const data: any = await res.json();
      text = data.content?.[0]?.text ?? "";
    }
    const match = text.match(/(?:0?\.\d+|[01](?:\.\d+)?)/);
    if (!match) return null;
    return Math.max(0, Math.min(1, Number.parseFloat(match[0])));
  } catch (err) {
    console.warn(`[lift] judge call failed: ${(err as Error).message}`);
    return null;
  }
}

/** Did the agent run to a clean success? */
function agentOk(result: Record<string, any> | null): boolean {
  return Boolean(
    result && result.is_error !== true && result.subtype === "success",
  );
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
  return m;
}

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

/** Aggregate a flat trial list into per-arm metrics (efficiency over ok trials). */
function summarize(trials: Trial[]): ArmSummary {
  const ok = trials.filter((t) => t.ok);
  const passes = trials.filter((t) => t.ok && t.reward >= 0.5).length;
  const meanReward =
    ok.length > 0 ? ok.reduce((s, t) => s + t.reward, 0) / ok.length : 0;
  return {
    passRate: trials.length > 0 ? passes / trials.length : 0,
    meanReward: round4(meanReward),
    medianDurationMs: Math.round(median(ok.map((t) => t.durationMs))),
    medianTurns: round4(median(ok.map((t) => t.numTurns))),
    medianTokens: Math.round(
      median(ok.map((t) => t.inputTokens + t.outputTokens)),
    ),
    medianCostUsd: round4(median(ok.map((t) => t.costUsd))),
  };
}

function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Format a signed lift number with a leading +/-. */
function signed(x: number, suffix = ""): string {
  return `${x >= 0 ? "+" : ""}${x}${suffix}`;
}

function printTable(
  withSkill: ArmSummary,
  withoutSkill: ArmSummary,
  lift: Record<string, number>,
  trials: number,
  rubricRan: boolean,
): void {
  const rows = [
    ["metric", "with skill", "without skill", "lift (with - without)"],
    [
      "pass rate",
      `${(withSkill.passRate * 100).toFixed(1)}%`,
      `${(withoutSkill.passRate * 100).toFixed(1)}%`,
      signed(round4(lift.passRate * 100), "pp"),
    ],
    [
      "mean reward",
      withSkill.meanReward.toFixed(3),
      withoutSkill.meanReward.toFixed(3),
      signed(round4(lift.meanReward)),
    ],
    [
      "median duration",
      fmtMs(withSkill.medianDurationMs),
      fmtMs(withoutSkill.medianDurationMs),
      `${lift.durationMs <= 0 ? "" : "+"}${fmtMs(lift.durationMs)}`,
    ],
    [
      "median turns",
      String(withSkill.medianTurns),
      String(withoutSkill.medianTurns),
      signed(round4(lift.turns)),
    ],
    [
      "median tokens",
      String(withSkill.medianTokens),
      String(withoutSkill.medianTokens),
      signed(lift.tokens),
    ],
    [
      "median cost",
      `$${withSkill.medianCostUsd.toFixed(4)}`,
      `$${withoutSkill.medianCostUsd.toFixed(4)}`,
      signed(round4(lift.costUsd)),
    ],
  ];
  const widths = rows[0].map((_, c) =>
    Math.max(...rows.map((r) => String(r[c]).length)),
  );
  const sep = widths.map((w) => "-".repeat(w)).join("-+-");
  console.log(
    `\n[lift] skill: ${SKILL_NAME}   trials/arm: ${trials}   ` +
      `judge: ${rubricRan ? "on" : "off (deterministic-only)"}\n`,
  );
  rows.forEach((row, i) => {
    console.log(
      row.map((cell, c) => String(cell).padEnd(widths[c])).join(" | "),
    );
    if (i === 0) console.log(sep);
  });
  console.log(
    "\n[lift] reading the lift column: NEGATIVE turns/tokens/duration/cost is GOOD " +
      "(skill made the agent leaner); POSITIVE pass rate / mean reward is GOOD.",
  );
}

async function runArm(
  label: ArmLabel,
  withSkill: boolean,
  trials: number,
  auth: Auth,
  rubric: string,
): Promise<Trial[]> {
  console.log(`\n[lift] ===== ${label} arm (${trials} trials) =====`);
  const out: Trial[] = [];
  for (let i = 0; i < trials; i++) {
    process.stdout.write(`[lift] ${label} trial ${i + 1}/${trials}... `);
    const { run, gate } = runTrial(withSkill, auth);
    const ok = agentOk(run.result);
    const r = run.result || {};
    const usage = r.usage || {};
    const gateScore = gate ? Number(gate.score) || 0 : 0;

    let judgeScore: number | null = null;
    if (ok && auth.judge) {
      judgeScore = await judgeTranscript(run.transcript, auth.judge, rubric);
    }
    const reward =
      judgeScore !== null ? 0.6 * gateScore + 0.4 * judgeScore : gateScore;

    const trial: Trial = {
      ok,
      gateScore: round4(gateScore),
      judgeScore: judgeScore !== null ? round4(judgeScore) : null,
      reward: round4(reward),
      durationMs: Number(r.duration_ms) || 0,
      numTurns: Number(r.num_turns) || 0,
      inputTokens: Number(usage.input_tokens) || 0,
      outputTokens: Number(usage.output_tokens) || 0,
      cacheReadTokens: Number(usage.cache_read_input_tokens) || 0,
      costUsd: Number(r.total_cost_usd) || 0,
    };
    if (!ok) {
      trial.error = String(
        r.api_error_status || r.subtype || "agent did not reach a result event",
      );
    }
    out.push(trial);
    console.log(
      ok
        ? `reward=${trial.reward.toFixed(2)} gate=${trial.gateScore.toFixed(2)}` +
            (judgeScore !== null ? ` judge=${judgeScore.toFixed(2)}` : "") +
            ` turns=${trial.numTurns} ${fmtMs(trial.durationMs)}`
        : `AGENT FAILED (${trial.error})`,
    );
  }
  return out;
}

async function main(): Promise<void> {
  const trials = resolveTrials();
  preflightDocker();
  const auth = preflightAuth();
  const rubric = readFileSync(path.join(EVAL_DIR, "rubric.md"), "utf8");

  buildImage();

  const withArm = await runArm("WITH-skill", true, trials, auth, rubric);
  const withoutArm = await runArm("WITHOUT-skill", false, trials, auth, rubric);

  // Fail loud if an entire arm's agent never ran — grading an untouched fixture
  // would make a broken agent look like "no lift" rather than an error.
  for (const [label, arm] of [
    ["WITH-skill", withArm],
    ["WITHOUT-skill", withoutArm],
  ] as const) {
    const failed = arm.filter((t) => !t.ok).length;
    if (failed === arm.length) {
      die(
        `${label} arm: the agent failed in ALL ${arm.length} trial(s), so the eval ` +
          `graded an untouched fixture. First error: ${arm[0]?.error}. ` +
          "Most common cause: a malformed agent token (an in-container API Error " +
          "usually means the auth header is garbage).",
      );
    }
    if (failed > 0) {
      console.warn(
        `[lift] WARNING: ${label} arm had ${failed}/${arm.length} agent failures; ` +
          "they are excluded from the efficiency medians.",
      );
    }
  }

  const withSkill = summarize(withArm);
  const withoutSkill = summarize(withoutArm);
  const lift = {
    passRate: round4(withSkill.passRate - withoutSkill.passRate),
    meanReward: round4(withSkill.meanReward - withoutSkill.meanReward),
    durationMs: withSkill.medianDurationMs - withoutSkill.medianDurationMs,
    turns: round4(withSkill.medianTurns - withoutSkill.medianTurns),
    tokens: withSkill.medianTokens - withoutSkill.medianTokens,
    costUsd: round4(withSkill.medianCostUsd - withoutSkill.medianCostUsd),
  };

  const rubricRan = Boolean(auth.judge);
  printTable(withSkill, withoutSkill, lift, trials, rubricRan);

  const result = {
    timestamp: new Date().toISOString(),
    skill: SKILL_NAME,
    trials,
    rubricRan,
    withSkill,
    withoutSkill,
    lift: {
      passRate: lift.passRate,
      durationMs: lift.durationMs,
      turns: lift.turns,
      tokens: lift.tokens,
      costUsd: lift.costUsd,
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

main().catch((err) => die(err.stack || String(err)));
