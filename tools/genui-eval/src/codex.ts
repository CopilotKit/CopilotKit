import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import type { ModelEntry } from "./config";
import { RESULTS_DIR } from "./results";

/**
 * The Codex backend: `codex:<model>` runs the model through the local Codex
 * CLI (`codex exec`), signed in with ChatGPT, so a run needs no OpenRouter
 * credit. At most `codexConcurrency` calls run at once (default 1). Every call is captured under
 * `results/codex/`: the instructions, the prompt, the JSONL events, the
 * final message and stderr.
 *
 * The system prompt of the call replaces Codex's own base instructions
 * (`model_instructions_file`), and Codex's extra instruction blocks, skills,
 * plugins, web search and tools are switched off, and the model gets a
 * catalog entry without code mode, multi-agent or patch tools. What Codex
 * still adds is about 2.5k tokens of fixed request overhead (its image
 * viewer tool among it). The agent's two state tools are not passed on: the
 * model sees only the system prompt and the conversation.
 */
export const CODEX_PREFIX = "codex:";

export function isCodexModel(model: string) {
  return model.startsWith(CODEX_PREFIX);
}

/** The Codex model slug of `codex:<slug>`, e.g. "gpt-5.6-luna". */
export const codexSlug = (model: string) => model.slice(CODEX_PREFIX.length);

/** The state tools the CopilotKit agent offers on every call. */
const AGENT_STATE_TOOLS = new Set([
  "AGUISendStateSnapshot",
  "AGUISendStateDelta",
]);

/** The Codex features that add instructions or tools a plain reply does not need. */
const FEATURES_OFF = [
  "apps",
  "browser_use",
  "computer_use",
  "fast_mode",
  "goals",
  "hooks",
  "image_generation",
  "in_app_browser",
  "multi_agent",
  "multi_agent_v2",
  "personality",
  "plugins",
  "shell_tool",
  "skill_search",
  "sleep_tool",
  "unified_exec",
];

/** The `codex exec` arguments of one call. The prompt comes on stdin. */
export function codexArgs(options: {
  slug: string;
  instructionsFile: string;
  cwd: string;
  lastMessageFile: string;
  reasoningEffort?: string;
  /** A plain one-model catalog (see `plainCatalog`), when there is one. */
  catalogFile?: string;
}) {
  const config = [
    `model_instructions_file=${JSON.stringify(options.instructionsFile)}`,
    ...(options.catalogFile
      ? [`model_catalog_json=${JSON.stringify(options.catalogFile)}`]
      : []),
    "include_permissions_instructions=false",
    "include_environment_context=false",
    "include_apps_instructions=false",
    "include_collaboration_mode_instructions=false",
    "skills.include_instructions=false",
    "tools.update_plan.enabled=false",
    "tools.experimental_request_user_input.enabled=false",
    "project_doc_max_bytes=0",
    'web_search_mode="disabled"',
    ...(options.reasoningEffort
      ? [`model_reasoning_effort="${options.reasoningEffort}"`]
      : []),
    ...FEATURES_OFF.map((feature) => `features.${feature}=false`),
  ];
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "--cd",
    options.cwd,
    "--model",
    options.slug,
    "--output-last-message",
    options.lastMessageFile,
    ...config.flatMap((c) => ["-c", c]),
    "-",
  ];
}

type Prompt = LanguageModelV3CallOptions["prompt"];

const partText = (content: unknown) =>
  typeof content === "string"
    ? content
    : (content as Array<{ type: string; text?: string }>)
        .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
        .join("");

/**
 * The instructions (every system message) and the user prompt of a call.
 * One user message is sent as it is; a longer conversation is written out
 * as a transcript, because `codex exec` takes one prompt.
 */
export function splitPrompt(prompt: Prompt) {
  const instructions = prompt
    .filter((m) => m.role === "system")
    .map((m) => partText(m.content))
    .join("\n\n");
  const turns = prompt.filter((m) => m.role !== "system");
  if (turns.some((m) => m.role === "tool")) {
    throw new Error(
      "the codex backend supports text replies only: use the markdown transport",
    );
  }
  const text =
    turns.length === 1 && turns[0].role === "user"
      ? partText(turns[0].content)
      : turns
          .map(
            (m) =>
              `${m.role === "user" ? "User" : "Assistant"}: ${partText(m.content)}`,
          )
          .join("\n\n");
  return { instructions, text };
}

/** What a `codex exec --json` run reported. */
export interface CodexResult {
  text: string;
  usage: {
    input: number;
    cachedInput: number;
    output: number;
    reasoning: number;
  };
}

/** Reads the final agent message and the token usage from the JSONL events. */
export function parseCodexEvents(jsonl: string): CodexResult {
  let text: string | undefined;
  const usage = { input: 0, cachedInput: 0, output: 0, reasoning: 0 };
  let failure: string | undefined;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, any>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      event.type === "item.completed" &&
      event.item?.type === "agent_message"
    ) {
      text = event.item.text;
    }
    if (event.type === "turn.completed" && event.usage) {
      usage.input += event.usage.input_tokens ?? 0;
      usage.cachedInput += event.usage.cached_input_tokens ?? 0;
      usage.output += event.usage.output_tokens ?? 0;
      usage.reasoning += event.usage.reasoning_output_tokens ?? 0;
    }
    if (event.type === "turn.failed" || event.type === "error") {
      failure = event.error?.message ?? event.message ?? JSON.stringify(event);
    }
  }
  if (text === undefined) {
    throw new Error(
      `codex returned no message${failure ? `: ${failure}` : ""}`,
    );
  }
  return { text, usage };
}

/**
 * A Codex home with only the user's sign-in: no user config, skills,
 * hooks, plugins or AGENTS.md reach the model. Its `cwd` is an empty
 * directory for the call.
 */
const userCodexHome = () => process.env.CODEX_HOME ?? `${homedir()}/.codex`;

function cleanHome() {
  const auth = `${userCodexHome()}/auth.json`;
  if (!existsSync(auth)) {
    throw new Error(
      `codex is not signed in (${auth} is missing): run "codex login"`,
    );
  }
  // One home per sign-in, so a home never points at another account's login.
  const key = createHash("sha1").update(auth).digest("hex").slice(0, 10);
  const home = `${tmpdir()}/genui-eval-codex-home-${key}`;
  const cwd = `${home}/cwd`;
  mkdirSync(cwd, { recursive: true });
  if (!existsSync(`${home}/auth.json`)) symlinkSync(auth, `${home}/auth.json`);
  return { home, cwd };
}

/**
 * A one-model catalog for `slug`, from the catalog Codex caches, with the
 * tool settings that add tool definitions and hints switched off: direct
 * tools instead of code mode, no multi-agent, no apply_patch, no search.
 * Undefined when no cached catalog lists the model; Codex then uses its own.
 */
export function plainCatalog(slug: string, homes: string[]) {
  for (const home of homes) {
    const file = `${home}/models_cache.json`;
    if (!existsSync(file)) continue;
    const cache = JSON.parse(readFileSync(file, "utf8")) as {
      models?: Array<Record<string, unknown>>;
    };
    const model = cache.models?.find((m) => m.slug === slug);
    if (!model) continue;
    const plain: Record<string, unknown> = {
      ...model,
      tool_mode: "direct",
      experimental_supported_tools: [],
      supports_search_tool: false,
      include_plugin_usage_instructions: false,
      include_apps_usage_instructions: false,
      include_skills_usage_instructions: false,
      node_repl_disabled: true,
    };
    for (const key of [
      "multi_agent_version",
      "apply_patch_tool_type",
      "web_search_tool_type",
    ]) {
      delete plain[key];
    }
    return { models: [plain] };
  }
  return undefined;
}

let found: { bin: string; version: string } | undefined;

/**
 * The codex binary: `GENUI_EVAL_CODEX_BIN`, or the first `codex` on the PATH
 * that runs. A broken global install (a missing native binary) is skipped.
 */
export function findCodex(env = process.env) {
  if (found) return found;
  const candidates = env.GENUI_EVAL_CODEX_BIN
    ? [env.GENUI_EVAL_CODEX_BIN]
    : (env.PATH ?? "")
        .split(":")
        .filter(Boolean)
        .map((dir) => `${dir}/codex`)
        .filter((bin) => existsSync(bin));
  for (const bin of candidates) {
    const probe = spawnSync(bin, ["--version"], {
      encoding: "utf8",
      timeout: 20_000,
    });
    if (probe.status === 0) {
      found = { bin, version: probe.stdout.trim() };
      return found;
    }
  }
  throw new Error(
    "no working codex CLI found: install it, or set GENUI_EVAL_CODEX_BIN to its path",
  );
}

let limit = 1;
let active = 0;
const waiting: Array<() => void> = [];

/** How many `codex exec` calls may run at once (the config's `codexConcurrency`). */
export function setCodexConcurrency(n: number) {
  limit = Math.max(1, Math.floor(n));
  while (active < limit && waiting.length > 0) {
    active++;
    waiting.shift()!();
  }
}

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  if (active < limit) active++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await run();
  } finally {
    const next = waiting.shift();
    // The slot passes straight to the next waiting call, or frees up.
    if (next) next();
    else active--;
  }
}

let calls = 0;

/** Runs one `codex exec` when a slot is free (see `setCodexConcurrency`), and captures it. */
export function runCodex(options: {
  slug: string;
  instructions: string;
  prompt: string;
  reasoningEffort?: string;
  /** Where the call's files go. Defaults to results/codex/<date>/<n>-<slug>/. */
  logDir?: string;
  timeoutMs?: number;
}): Promise<CodexResult & { logDir: string }> {
  return withSlot(() => runCodexNow(options));
}

async function runCodexNow(options: Parameters<typeof runCodex>[0]) {
  const { home, cwd } = cleanHome();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logDir =
    options.logDir ??
    `${RESULTS_DIR}codex/${stamp.slice(0, 10)}/${stamp}-${++calls}-${options.slug}`;
  mkdirSync(logDir, { recursive: true });
  const instructionsFile = `${logDir}/instructions.md`;
  writeFileSync(instructionsFile, options.instructions);
  writeFileSync(`${logDir}/prompt.md`, options.prompt);
  const catalog = plainCatalog(options.slug, [home, userCodexHome()]);
  const catalogFile = catalog ? `${logDir}/catalog.json` : undefined;
  if (catalogFile) writeFileSync(catalogFile, JSON.stringify(catalog));
  const args = codexArgs({
    slug: options.slug,
    instructionsFile,
    cwd,
    lastMessageFile: `${logDir}/last-message.md`,
    reasoningEffort: options.reasoningEffort,
    catalogFile,
  });
  const { bin, version } = findCodex();
  writeFileSync(
    `${logDir}/command.json`,
    JSON.stringify({ bin, version, args }, null, 2),
  );
  const { code, stdout, stderr } = await new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, CODEX_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(
      () => child.kill("SIGTERM"),
      options.timeoutMs ?? 10 * 60_000,
    );
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`could not start codex (${bin}): ${error.message}`));
    });
    child.on("close", (exit) => {
      clearTimeout(timer);
      resolve({ code: exit, stdout: out, stderr: err });
    });
    child.stdin.end(options.prompt);
  });
  writeFileSync(`${logDir}/events.jsonl`, stdout);
  writeFileSync(`${logDir}/stderr.txt`, stderr);
  if (code !== 0) {
    throw new Error(
      `codex exited with ${code}: ${(stderr.trim().split("\n").pop() ?? "").slice(0, 300)} (log: ${logDir})`,
    );
  }
  return { ...parseCodexEvents(stdout), logDir };
}

/** The AI SDK model of a `codex:<slug>` entry. `report` gets the log directory of each call. */
export function createCodexModel(
  entry: Pick<ModelEntry, "model" | "params">,
  report: (meta: { log?: string }) => void = () => {},
): LanguageModelV3 {
  const slug = codexSlug(entry.model);
  const call = async (options: LanguageModelV3CallOptions) => {
    // The agent always offers its two state tools; a markdown reply does not
    // need them, and codex cannot pass them on. Any other tool (render_ui)
    // means the tool transport, which this backend does not support.
    const other = (options.tools ?? []).filter(
      (t) => !AGENT_STATE_TOOLS.has(t.name),
    );
    if (other.length > 0) {
      throw new Error(
        `the codex backend supports text replies only (got tools: ${other.map((t) => t.name).join(", ")}): use the markdown transport`,
      );
    }
    const { instructions, text } = splitPrompt(options.prompt);
    const result = await runCodex({
      slug,
      instructions,
      prompt: text,
      reasoningEffort: entry.params?.reasoningEffort,
    });
    report({ log: result.logDir });
    const usage = {
      inputTokens: {
        total: result.usage.input,
        noCache: result.usage.input - result.usage.cachedInput,
        cacheRead: result.usage.cachedInput,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: result.usage.output,
        text: result.usage.output - result.usage.reasoning,
        reasoning: result.usage.reasoning,
      },
    };
    return { text: result.text, usage };
  };
  return {
    specificationVersion: "v3",
    provider: "codex",
    modelId: slug,
    supportedUrls: {},
    doGenerate: async (options) => {
      const { text, usage } = await call(options);
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      };
    },
    doStream: async (options) => {
      const { text, usage } = await call(options);
      const chunks: LanguageModelV3StreamPart[] = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        ...(text.match(/[\s\S]{1,200}/g) ?? [""]).map((delta) => ({
          type: "text-delta" as const,
          id: "t1",
          delta,
        })),
        { type: "text-end", id: "t1" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage,
        },
      ];
      return { stream: simulateReadableStream({ chunks }) };
    },
  };
}
