#!/usr/bin/env node
/**
 * Skill-lift comparison harness for the copilotkit-setup skill.
 *
 * WHAT THIS DOES
 *   Runs the same task in N trials per arm, each in its own fresh container:
 *     1. WITH the skill mounted at /workspace/.claude/skills/copilotkit-setup
 *     2. WITHOUT it (the dir is simply absent)
 *   then diffs the two arms. The agent is real Claude Code (`claude -p`), invoked
 *   with --output-format stream-json so we read REAL efficiency signal off the
 *   result event — num_turns, usage tokens, duration_ms, total_cost_usd — instead
 *   of estimates. The with/without difference is literally "is the skill dir
 *   present", a `docker cp` toggle, not a hack.
 *
 *   Trials run in a bounded-concurrency pool (--concurrency, default 4): each is
 *   independent, so several containers run at once and the wall-clock collapses
 *   from sum-of-trials to roughly slowest-wave. Lower concurrency if you hit the
 *   agent's API rate limit or run low on RAM.
 *
 *   lift.* = withSkill - withoutSkill, so:
 *     - NEGATIVE turns / tokens / durationMs / costUsd is GOOD (skill = leaner);
 *     - POSITIVE passRate is GOOD (skill = more correct).
 *
 * SCORING (per trial)
 *   - GATE (always): graders/check.ts builds / type-checks the agent's output in
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

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// --- output styling -----------------------------------------------------------
// Color only on a real TTY (and honor NO_COLOR), so piping to a log file or CI
// stays clean plain text instead of ANSI escape soup.
const USE_COLOR =
  Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
const paint =
  (code: string) =>
  (s: string | number): string =>
    USE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s);
const clr = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  cyan: paint("36"),
};

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

/**
 * Resolve max concurrent trials: --concurrency=N > SKILL_EVAL_CONCURRENCY > 4.
 * Trials are independent, so this is purely a throttle on simultaneous
 * containers + simultaneous agent API sessions. Lower it (e.g. =2) if you hit
 * the agent's rate limit on a subscription token or run low on RAM; raise it on
 * a beefy host with generous limits.
 */
function resolveConcurrency(): number {
  const flag = process.argv
    .slice(2)
    .find((a) => a.startsWith("--concurrency="));
  const raw = flag ? flag.split("=")[1] : process.env.SKILL_EVAL_CONCURRENCY;
  if (raw === undefined) return 4;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    die(`invalid concurrency "${raw}" (must be a positive integer)`);
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

  return { agentEnv, judge };
}

/**
 * Build the eval image once. Quiet on success (`-q` collapses the ~200-line
 * apt/npm build log to nothing); on failure the captured output is printed so
 * the error is still actionable.
 */
function buildImage(): void {
  if (!existsSync(SKILL_DIR)) {
    die(`skill under test not found at ${SKILL_DIR}.`);
  }
  process.stdout.write(` ${clr.dim("Building eval image…")} `);
  const t0 = Date.now();
  const res = spawnSync(
    "docker",
    [
      "build",
      "-q",
      "-t",
      IMAGE,
      "-f",
      path.join(EVAL_DIR, "Dockerfile"),
      EVAL_DIR,
    ],
    { encoding: "utf8" },
  );
  if (res.status !== 0) {
    process.stdout.write("\n");
    console.error(`${res.stdout || ""}${res.stderr || ""}`);
    die("docker build failed (see output above).");
  }
  console.log(
    `${clr.green("done")} ${clr.dim(`(${Math.round((Date.now() - t0) / 1000)}s)`)}`,
  );
}

interface DockerResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run a docker subcommand ASYNCHRONOUSLY, capturing stdout/stderr. Async (not
 * spawnSync) is what makes parallel trials possible: spawnSync blocks the single
 * Node thread, so N "concurrent" trials would still serialize. With async spawn,
 * the concurrency pool can have several containers in flight at once.
 */
function docker(
  args: string[],
  opts: { timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<DockerResult> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, {
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, opts.timeoutMs)
      : null;
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ status: 1, stdout, stderr: `${stderr}${err}`, timedOut });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ status: code, stdout, stderr, timedOut });
    });
  });
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

// The task instruction (instruction.md) is one human sentence on purpose. This
// operational guard is a HARNESS concern, not part of the task, so it is appended
// here at invocation rather than polluting the human-readable instruction file:
// without it a stray `npm run dev` would block a trial until AGENT_TIMEOUT_MS.
const OPERATIONAL_GUARD =
  "Just write the files. Do not start dev servers or leave any long-running " +
  "processes; the result is graded from the files on disk and a build.";

/** Run one trial in a fresh container. Returns its parsed agent run + gate score. */
async function runTrial(
  withSkill: boolean,
  auth: Auth,
): Promise<{ run: AgentRun; gate: { score: number } | null; stderr: string }> {
  const created = await docker([
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
      await docker(["exec", cid, "mkdir", "-p", CONTAINER_SKILL_DIR]);
      const cp = await docker([
        "cp",
        `${SKILL_DIR}/.`,
        `${cid}:${CONTAINER_SKILL_DIR}`,
      ]);
      if (cp.status !== 0) {
        die(`failed to copy the skill into the container: ${cp.stderr.trim()}`);
      }
    }

    // Run the agent. IS_SANDBOX=1 lets --dangerously-skip-permissions run as root
    // (the container IS the sandbox). The instruction is baked at /eval-tools; the
    // operational guard is appended inside the same double-quoted prompt.
    const envFlags: string[] = ["-e", "IS_SANDBOX=1"];
    for (const [k, v] of Object.entries(auth.agentEnv)) {
      envFlags.push("-e", `${k}=${v}`);
    }
    const agent = await docker(
      [
        "exec",
        ...envFlags,
        cid,
        "bash",
        "-lc",
        `claude -p "$(cat /eval-tools/instruction.md)\n\n${OPERATIONAL_GUARD}" ` +
          "--output-format stream-json --verbose --dangerously-skip-permissions",
      ],
      { timeoutMs: AGENT_TIMEOUT_MS },
    );
    const run = parseStreamJson(agent.stdout);
    if (agent.timedOut) {
      run.result = run.result ?? { is_error: true, subtype: "timeout" };
    }

    // Gate: build / type-check the agent's output via the TypeScript grader.
    const graded = await docker(["exec", cid, "tsx", "/eval-tools/check.ts"], {
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
    return { run, gate, stderr: agent.stderr };
  } finally {
    await docker(["rm", "-f", cid]);
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
function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
/** Signed number with a real minus glyph: -1.2 -> "−1.2". */
function signNum(x: number, dp: number, suffix = ""): string {
  return `${x < 0 ? "−" : "+"}${Math.abs(x).toFixed(dp)}${suffix}`;
}
function signMoney(x: number): string {
  return `${x < 0 ? "−" : "+"}$${Math.abs(x).toFixed(2)}`;
}
function signMs(ms: number): string {
  return `${ms < 0 ? "−" : "+"}${fmtMs(Math.abs(ms))}`;
}

const BAR = "━".repeat(56);

/** Wrap a string to lines of at most `width` chars, breaking on spaces. */
function wrapText(s: string, width: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of s.trim().split(/\s+/)) {
    if (cur && cur.length + 1 + word.length > width) {
      lines.push(cur);
      cur = word;
    } else {
      cur = cur ? `${cur} ${word}` : word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Title + the verbatim task + run config, printed before any work starts. */
function printHeader(
  task: string,
  trials: number,
  concurrency: number,
  judge: JudgeConfig | null,
): void {
  console.log(`\n${clr.cyan(BAR)}`);
  console.log(` ${clr.bold(`Skill-lift eval · ${SKILL_NAME}`)}`);
  console.log(`${clr.cyan(BAR)}\n`);

  console.log(` ${clr.bold("Task given to the agent")}`);
  const wrapped = wrapText(task, 60);
  wrapped.forEach((line, i) => {
    const open = i === 0 ? "“" : " ";
    const close = i === wrapped.length - 1 ? "”" : "";
    console.log(`   ${clr.cyan(`${open}${line}${close}`)}`);
  });

  const judgeStr = judge
    ? `${judge.provider} (${judge.model})`
    : "off (deterministic-only)";
  console.log(
    `\n ${clr.dim(`${trials} trials/arm · concurrency ${concurrency} · judge: ${judgeStr}`)}`,
  );
}

interface LiftRow {
  label: string;
  withVal: string;
  withoutVal: string;
  lift: string;
  good: boolean;
  negligible: boolean;
}

/** The with/without/lift rows, shared by the terminal table and the CI summary. */
function buildLiftRows(
  withSkill: ArmSummary,
  withoutSkill: ArmSummary,
  lift: Record<string, number>,
): LiftRow[] {
  return [
    {
      label: "pass rate",
      withVal: pct(withSkill.passRate),
      withoutVal: pct(withoutSkill.passRate),
      lift: signNum(lift.passRate * 100, 1, "pp"),
      good: lift.passRate > 0,
      negligible: Math.abs(lift.passRate) < 0.001,
    },
    {
      label: "mean reward",
      withVal: withSkill.meanReward.toFixed(2),
      withoutVal: withoutSkill.meanReward.toFixed(2),
      lift: signNum(lift.meanReward, 2),
      good: lift.meanReward > 0,
      negligible: Math.abs(lift.meanReward) < 0.005,
    },
    {
      label: "median cost",
      withVal: `$${withSkill.medianCostUsd.toFixed(2)}`,
      withoutVal: `$${withoutSkill.medianCostUsd.toFixed(2)}`,
      lift: signMoney(lift.costUsd),
      good: lift.costUsd < 0,
      negligible: Math.abs(lift.costUsd) < 0.005,
    },
    {
      label: "median turns",
      withVal: String(withSkill.medianTurns),
      withoutVal: String(withoutSkill.medianTurns),
      lift: signNum(lift.turns, 0),
      good: lift.turns < 0,
      negligible: Math.abs(lift.turns) < 0.5,
    },
    {
      label: "median tokens",
      withVal: String(withSkill.medianTokens),
      withoutVal: String(withoutSkill.medianTokens),
      lift: signNum(lift.tokens, 0),
      good: lift.tokens < 0,
      negligible: Math.abs(lift.tokens) < 50,
    },
    {
      label: "median duration",
      withVal: fmtMs(withSkill.medianDurationMs),
      withoutVal: fmtMs(withoutSkill.medianDurationMs),
      lift: signMs(lift.durationMs),
      good: lift.durationMs < 0,
      negligible: Math.abs(lift.durationMs) < 2000,
    },
  ];
}

/** The results block: aligned with/without/lift columns + a ✔ where it helped. */
function printTable(
  withSkill: ArmSummary,
  withoutSkill: ArmSummary,
  lift: Record<string, number>,
): void {
  const rows = buildLiftRows(withSkill, withoutSkill, lift);

  const headers = { label: "", w: "with", wo: "without", f: "lift" };
  const lw = Math.max(headers.label.length, ...rows.map((r) => r.label.length));
  const ww = Math.max(headers.w.length, ...rows.map((r) => r.withVal.length));
  const ow = Math.max(
    headers.wo.length,
    ...rows.map((r) => r.withoutVal.length),
  );
  const fw = Math.max(headers.f.length, ...rows.map((r) => r.lift.length));

  console.log(`\n${clr.cyan("━━ Results ")}${clr.cyan("━".repeat(45))}\n`);
  console.log(
    clr.dim(
      `   ${headers.label.padEnd(lw)}   ${headers.w.padStart(ww)}   ` +
        `${headers.wo.padStart(ow)}   ${headers.f.padStart(fw)}`,
    ),
  );
  for (const r of rows) {
    const liftCell = r.lift.padStart(fw);
    const mark = r.negligible
      ? clr.dim("·")
      : r.good
        ? clr.green("✔")
        : clr.dim("–");
    const liftOut = r.negligible
      ? clr.dim(liftCell)
      : r.good
        ? clr.green(liftCell)
        : liftCell;
    console.log(
      `   ${r.label.padEnd(lw)}   ${r.withVal.padStart(ww)}   ` +
        `${r.withoutVal.padStart(ow)}   ${liftOut}   ${mark}`,
    );
  }
  console.log(
    `\n   ${clr.green("✔")} ${clr.dim(
      "= skill helped. Lower turns/tokens/cost/duration is better;",
    )}`,
  );
  console.log(`     ${clr.dim("higher pass rate / reward is better.")}`);
}

/** The lift cell for the CI summary: sign + a mark for helped / neutral / hurt. */
function summaryLiftCell(r: LiftRow): string {
  return r.negligible
    ? `${r.lift} ·`
    : r.good
      ? `${r.lift} ✅`
      : `${r.lift} ⚠️`;
}

/**
 * When running under GitHub Actions, append a markdown lift table to the job's
 * Step Summary so a scheduled run is readable at a glance from the Actions tab —
 * no artifact download. No-op locally (GITHUB_STEP_SUMMARY unset). Same numbers
 * as the terminal table, via the shared buildLiftRows().
 */
function writeStepSummary(
  withSkill: ArmSummary,
  withoutSkill: ArmSummary,
  lift: Record<string, number>,
  trials: number,
  rubricRan: boolean,
): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;

  const rows = buildLiftRows(withSkill, withoutSkill, lift);
  const md = [
    `## Skill-lift eval · ${SKILL_NAME}`,
    "",
    `${trials} trials/arm · trace judge: ${rubricRan ? "ran" : "skipped"}`,
    "",
    "| metric | with skill | without skill | lift |",
    "| --- | ---: | ---: | ---: |",
    ...rows.map(
      (r) =>
        `| ${r.label} | ${r.withVal} | ${r.withoutVal} | ${summaryLiftCell(r)} |`,
    ),
    "",
    "✅ = skill helped. Lower turns/tokens/cost/duration is better; higher pass rate / reward is better.",
    "",
  ].join("\n");
  appendFileSync(file, `${md}\n`);
}

interface TrialTask {
  arm: ArmLabel;
  withSkill: boolean;
  index: number;
}

/**
 * Bounded-concurrency map: run `worker` over every item, at most `limit` in
 * flight at once, preserving input order in the result array. This is what
 * parallelizes the trials — each trial is fully independent (its own fresh
 * container, no shared state), so the only ceiling is host resources and the
 * agent API rate limit, both bounded by `limit`.
 */
async function pool<I, O>(
  items: I[],
  limit: number,
  worker: (item: I) => Promise<O>,
): Promise<O[]> {
  // Each lane writes results[task.index], so order is preserved without presizing.
  const results: O[] = [];
  let cursor = 0;
  async function lane(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: lanes }, () => lane()));
  return results;
}

/** Run one trial end-to-end (container → agent → gate → judge) into a Trial. */
async function runOneTrial(
  task: TrialTask,
  trials: number,
  auth: Auth,
  rubric: string,
): Promise<Trial> {
  const { run, gate, stderr } = await runTrial(task.withSkill, auth);
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
    // Surface the ACTUAL failure, not just a bare status code. Claude Code puts
    // the API error text in the result event's `result`/`error` field; anything
    // that killed the CLI before a result event lands only in stderr. Both were
    // being discarded, which is why a 400 read as an opaque "400" in CI.
    const status = r.api_error_status || r.subtype;
    const detail = String(r.result || r.error || "").trim();
    const errTail = stderr.trim().split("\n").slice(-4).join(" | ");
    trial.error =
      [status, detail].filter(Boolean).join(": ") ||
      errTail ||
      "agent did not reach a result event";
  }

  // One standalone line per trial — trials finish out of order under concurrency,
  // so the label carries the arm + index instead of relying on print order.
  const label = task.arm.padEnd("WITHOUT-skill".length);
  const id = `#${task.index + 1}`;
  if (ok) {
    // Color the reward by band so good/bad reads at a glance.
    const rw = trial.reward;
    const rewardStr =
      rw >= 0.8
        ? clr.green(rw.toFixed(2))
        : rw >= 0.5
          ? clr.yellow(rw.toFixed(2))
          : clr.red(rw.toFixed(2));
    const judgePart =
      judgeScore !== null ? `  judge ${judgeScore.toFixed(2)}` : "";
    console.log(
      `   ${label} ${id}  ${clr.green("✔")}  reward ${rewardStr}  ` +
        `gate ${trial.gateScore.toFixed(2)}${judgePart}  ` +
        clr.dim(`  ${trial.numTurns} turns · ${fmtMs(trial.durationMs)}`),
    );
  } else {
    console.log(
      `   ${label} ${id}  ${clr.red("✗")}  ${clr.red(`agent failed (${trial.error})`)}`,
    );
  }
  return trial;
}

async function main(): Promise<void> {
  const trials = resolveTrials();
  const concurrency = resolveConcurrency();
  preflightDocker();
  const auth = preflightAuth();
  const rubric = readFileSync(path.join(EVAL_DIR, "rubric.md"), "utf8");
  const instruction = readFileSync(
    path.join(EVAL_DIR, "instruction.md"),
    "utf8",
  ).trim();

  printHeader(instruction, trials, concurrency, auth.judge);
  console.log("");
  buildImage();

  // Both arms are one flat pool of independent trials (WITH first, WITHOUT
  // second). Running them together keeps every concurrency lane busy instead of
  // draining one arm before starting the next.
  const tasks: TrialTask[] = [
    ...Array.from({ length: trials }, (_, index) => ({
      arm: "WITH-skill" as const,
      withSkill: true,
      index,
    })),
    ...Array.from({ length: trials }, (_, index) => ({
      arm: "WITHOUT-skill" as const,
      withSkill: false,
      index,
    })),
  ];
  console.log(
    `\n ${clr.bold("Trials")} ${clr.dim(`(running ${tasks.length}, ✔ = agent completed)`)}`,
  );
  const all = await pool(tasks, concurrency, (task) =>
    runOneTrial(task, trials, auth, rubric),
  );
  const withArm = all.slice(0, trials);
  const withoutArm = all.slice(trials);

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
      console.log(
        clr.yellow(
          `   ! ${label}: ${failed}/${arm.length} agent failures (excluded from medians)`,
        ),
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
  printTable(withSkill, withoutSkill, lift);
  writeStepSummary(withSkill, withoutSkill, lift, trials, rubricRan);

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
  const relOut = path.relative(process.cwd(), outFile);
  console.log(`\n ${clr.dim("Results →")} ${relOut}\n`);
}

main().catch((err) => die(err.stack || String(err)));
