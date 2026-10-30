/**
 * Scores the composer per model and format on the tasks in src/evals/tasks.ts,
 * with the same code the playground runs (no router: each task goes straight
 * to the composer that writes the surface).
 *
 *  - valid render: the surface passes CopilotKit's own `validateOperation`
 *    (the check the browser runs before it renders), with a root and no
 *    reference to a missing component;
 *  - component choice: the share of a task's expected component groups the
 *    surface uses;
 *  - latency and size: time to the finished surface, and characters written.
 *
 * Results go to src/data/evals.json, which /evals shows, or to --out.
 *
 *   pnpm evals                                  every model set up here, both formats
 *   pnpm evals --models gemini,gemma --formats express --tasks sales-dashboard,flights
 *   pnpm evals --label "mock model"             label a run that is not a real model (a harness check)
 *   pnpm evals --skill my-skill.zip             only the components of a skill from /skills (a zip or its folder)
 *   pnpm evals --out results.json               write somewhere other than src/data/evals.json
 *
 * With --skill the composer's catalog is the skill's components, and a surface
 * that uses a component the skill leaves out does not count as valid. It runs
 * the JSON composer only: the Express composer reads the whole catalog.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  createGenerativeUI,
  standardUI,
} from "@copilotkit/react-core/v2/generative-ui";
import {
  A2UI_VERSION,
  childIdsAtRefs,
  collectChildRefs,
  GENERATIVE_UI_FUNCTIONS,
  validateOperation,
  type GenerativeUIManifest,
} from "@copilotkit/shared";
import type { ComponentType } from "react";
import { ownEntries } from "../src/a2ui/catalog/entries";
import { CATALOG_ID } from "../src/a2ui/catalog/ids";
import { compose, type ComposeInput } from "../src/agent/composer";
import { composeExpress } from "../src/agent/compose-express";
import { EventQueue } from "../src/agent/events";
import { MODELS, type ModelId } from "../src/agent/models";
import { EVAL_TASKS } from "../src/evals/tasks";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** The files of a zip, by path. Reads stored and deflated entries, which covers /skills downloads and re-zipped folders. */
/** Provider errors can echo a key or a token; results are committed, so those never reach a problem. */
function redact(message: string): string {
  return message
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,})/g, "[redacted]")
    .replace(/\b(Bearer\s+|key=)[^\s&"']+/gi, "$1[redacted]");
}

function unzip(path: string): Record<string, string> {
  const buf = readFileSync(path);
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error(`${path} is not a zip file.`);
  const files: Record<string, string> = {};
  for (
    let i = 0, p = buf.readUInt32LE(end + 16);
    i < buf.readUInt16LE(end + 10);
    i++
  ) {
    const [method, size, nameLength, local] = [
      buf.readUInt16LE(p + 10),
      buf.readUInt32LE(p + 20),
      buf.readUInt16LE(p + 28),
      buf.readUInt32LE(p + 42),
    ];
    const name = buf.toString("utf8", p + 46, p + 46 + nameLength);
    const start =
      local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (!name.endsWith("/"))
      files[name] = (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return files;
}

/** The text files of a folder, by path, a few levels deep. */
function readFolder(
  root: string,
  dir = root,
  depth = 0,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (depth < 3 && !entry.startsWith(".") && entry !== "node_modules")
        Object.assign(files, readFolder(root, path, depth + 1));
    } else if (entry === "catalog.json" || entry === "SKILL.md")
      files[relative(root, path)] = readFileSync(path, "utf8");
  }
  return files;
}

/** A skill from /skills, as its zip or its folder: its name and the components its catalog.json keeps. */
function loadSkill(path: string): { name: string; components: string[] } {
  if (!existsSync(path)) throw new Error(`No skill at ${path}.`);
  const files = statSync(path).isDirectory() ? readFolder(path) : unzip(path);
  const catalogs = Object.keys(files).filter(
    (f) => basename(f) === "catalog.json",
  );
  if (catalogs.length !== 1)
    throw new Error(
      catalogs.length
        ? `${path} has ${catalogs.length} skills (${catalogs.map(dirname).join(", ")}): point --skill at one of them.`
        : `${path} has no catalog.json: download a skill from /skills.`,
    );
  const dir = dirname(catalogs[0]);
  const named = /^name:\s*(.+)$/m
    .exec(files[join(dir, "SKILL.md")] ?? "")?.[1]
    ?.trim();
  const catalog = JSON.parse(files[catalogs[0]]) as {
    components?: Record<string, unknown>;
  };
  return {
    name: named ?? (dir === "." ? basename(resolve(path)) : basename(dir)),
    components: Object.keys(catalog.components ?? {}),
  };
}

const skillPath = arg("skill");
const skill = skillPath ? loadSkill(skillPath) : undefined;
const models = (arg("models")?.split(",") ?? Object.keys(MODELS)) as ModelId[];
const formats = (arg("formats")?.split(",") ??
  (skill ? ["json"] : ["express", "json"])) as Array<"express" | "json">;
const tasks = arg("tasks")
  ? EVAL_TASKS.filter((t) => arg("tasks")!.split(",").includes(t.id))
  : EVAL_TASKS;
const label = arg("label");
const out = arg("out")
  ? resolve(arg("out")!)
  : join(__dirname, "../src/data/evals.json");
if (skill && formats.includes("express")) {
  console.error(
    "--skill runs the JSON composer only, because the Express composer reads the whole catalog (src/agent/express.ts). Use --formats json.",
  );
  process.exit(1);
}

// The manifest the browser sends: the catalog's components and the built-in functions.
const Stub: ComponentType = () => null;
const ui = createGenerativeUI({
  id: CATALOG_ID,
  extends: [standardUI],
  components: ownEntries(() => Stub) as never,
}) as unknown as { manifestComponents: GenerativeUIManifest["components"] };
const fullManifest = {
  catalogId: CATALOG_ID,
  catalogIds: [CATALOG_ID, (standardUI as unknown as { id: string }).id],
  components: ui.manifestComponents,
  functions: Object.fromEntries(
    Object.entries(GENERATIVE_UI_FUNCTIONS).map(([name, fn]) => [
      name,
      {
        description: fn.description,
        parameters: { type: "object", description: fn.parameters },
        returnType: fn.returnType,
        allowedCallers: fn.allowedCallers,
      },
    ]),
  ),
  targets: [{ id: "chat", kind: "chat" }],
  surfaces: {},
} as unknown as GenerativeUIManifest;

// With a skill, the composer sees only the skill's components (macros are listed by the composer itself).
const allowed = skill ? new Set(skill.components) : undefined;
const manifest = allowed
  ? {
      ...fullManifest,
      components: Object.fromEntries(
        Object.entries(fullManifest.components).filter(([name]) =>
          allowed.has(name),
        ),
      ),
    }
  : fullManifest;
if (skill)
  console.log(
    `skill ${skill.name}: the composer gets ${Object.keys(manifest.components).length} of the catalog's components`,
  );

type Node = { id: string; component: string; [k: string]: unknown };

/** Why the browser would not render this surface, or nothing. */
function renderProblem(
  components: Node[],
  data: Record<string, unknown>,
): string | undefined {
  const op = {
    version: A2UI_VERSION,
    createSurface: {
      surfaceId: "eval",
      catalogId: CATALOG_ID,
      components,
      ...(Object.keys(data).length ? { dataModel: data } : {}),
    },
  };
  const v = validateOperation(op, {
    manifest: fullManifest,
    knownSurfaces: new Set(),
    createdSurfaces: new Set(),
    functions: fullManifest.functions,
  });
  if (!v.ok) return v.reason;
  if (!components.some((c) => c.id === "root")) return "no root component";
  const ids = new Set(components.map((c) => c.id));
  for (const c of components) {
    const entry = fullManifest.components[c.component];
    const missing =
      entry &&
      childIdsAtRefs(c, collectChildRefs(entry.props)).find(
        (id) => !ids.has(id),
      );
    if (missing)
      return `component "${c.id}" references missing component "${missing}"`;
  }
  if (components.some((c) => c.component === "Blueprint"))
    return "a component never finished";
  return undefined;
}

type TaskResult = {
  id: string;
  valid: boolean;
  problem?: string;
  choice: number;
  used: string[];
  composeMs: number;
  firstTokenMs: number | null;
  outputChars: number;
  jsonChars: number;
  expressChars: number;
};

async function runOne(
  model: ModelId,
  format: "express" | "json",
  task: (typeof EVAL_TASKS)[number],
): Promise<TaskResult> {
  const spec = MODELS[model];
  const q = new EventQueue();
  const input: ComposeInput = {
    brief: task.prompt,
    conversation: `user: ${task.prompt}`,
    manifest,
    toolCallId: `eval-${task.id}`,
    t0: performance.now(),
    q,
    model: spec,
    client: spec.client(),
    signal: AbortSignal.timeout(120_000),
    // Score Express itself, not the playground's JSON fallback.
    noFallback: true,
  };
  try {
    const r = await (format === "express" ? composeExpress : compose)(input);
    const used = [...new Set((r.written as Node[]).map((c) => c.component))];
    const outside = allowed ? used.filter((c) => !allowed.has(c)) : [];
    const problem =
      renderProblem(r.components as Node[], r.data) ??
      (outside.length
        ? `uses ${outside.join(", ")}, which the skill leaves out`
        : undefined);
    const choice =
      task.expect.filter((group) => group.some((c) => used.includes(c)))
        .length / task.expect.length;
    return {
      id: task.id,
      valid: !problem,
      problem,
      choice,
      used,
      composeMs: r.stats.composeMs,
      firstTokenMs: r.stats.firstTokenMs,
      outputChars: r.stats.outputChars,
      jsonChars: r.stats.jsonChars,
      expressChars: r.stats.expressChars,
    };
  } catch (err) {
    return {
      id: task.id,
      valid: false,
      problem: redact(err instanceof Error ? err.message : String(err)).slice(
        0,
        300,
      ),
      choice: 0,
      used: [],
      composeMs: 0,
      firstTokenMs: null,
      outputChars: 0,
      jsonChars: 0,
      expressChars: 0,
    };
  } finally {
    q.close();
  }
}

const median = (xs: number[]) => {
  const s = xs.filter((x) => x > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

async function main() {
  const runs = [];
  for (const model of models) {
    const spec = MODELS[model];
    const missing = spec.missing();
    for (const format of formats) {
      if (missing) {
        runs.push({
          model,
          label: spec.label,
          composer: spec.composer,
          format,
          skipped: missing,
          tasks: [] as TaskResult[],
        });
        console.log(`${spec.label} ${format}: skipped (${missing})`);
        continue;
      }
      const results: TaskResult[] = [];
      for (const task of tasks) {
        const r = await runOne(model, format, task);
        results.push(r);
        console.log(
          `${spec.label} ${format} ${task.id}: ${r.valid ? "valid" : `INVALID (${r.problem})`}, choice ${Math.round(r.choice * 100)}%, ${r.composeMs} ms, ${r.outputChars} ch`,
        );
      }
      runs.push({
        model,
        label: spec.label,
        composer: spec.composer,
        format,
        tasks: results,
        summary: {
          validRate: results.filter((r) => r.valid).length / results.length,
          choice: results.reduce((n, r) => n + r.choice, 0) / results.length,
          medianMs: median(results.map((r) => r.composeMs)),
          medianChars: median(results.map((r) => r.outputChars)),
        },
      });
    }
  }

  const result = {
    ranAt: new Date().toISOString(),
    ...(label ? { label } : {}),
    ...(skill
      ? { skill: { name: skill.name, components: skill.components.length } }
      : {}),
    tasks: tasks.map((t) => ({ id: t.id, prompt: t.prompt, expect: t.expect })),
    runs,
  };
  writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
  const shown = relative(process.cwd(), out);
  console.log(`-> ${shown.startsWith("..") ? out : shown}`);
}

main().then(() => process.exit(0));
