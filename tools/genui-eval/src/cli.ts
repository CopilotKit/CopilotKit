import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadCases, selectCases } from "./cases";
import type { EvalConfig, Preset, Transport } from "./config";
import { resolvePlan, TRANSPORTS } from "./config";
import { renderedPrompts } from "./harness";
import { calibrate, readLabels } from "./judge";
import type { LabelRow } from "./judge";
import { buildReport, failures, formatReport } from "./report";
import { TIERS, readRun } from "./results";
import type { Tier } from "./results";
import { estimateRun, runEval } from "./run";
import { loadSpec } from "./spec";

const TOOL_ROOT = fileURLToPath(new URL("../", import.meta.url));

const USAGE = `genui-eval: measure and improve the A2UI output of the generative UI prompts

  run        [--preset full] [--models a,b] [--cases all|tag:<t>] [--samples n]
             [--transports markdown,tool] [--split both|train|heldout]
             [--budget usd] [--spec file.json] [--estimate]
  report     <run|latest> [--base <run>]
  failures   <run|latest> [--model id] [--tier validity|fidelity|judgement|quality]
             [--case id] [--limit n]
  prompt     [--transport markdown|tool] [--spec file.json]
  optimize   [--preset full] [--budget usd] [--rounds n] [--batch n] [--models a,b]
             [--from spec.json]
  label      <run|latest> [--n 20]       write samples to grade by hand
  calibrate  <labels.jsonl>              agreement of the judge with the hand labels

Every command takes --json and --config <file> (default eval.config.ts).
Real models need OPENROUTER_API_KEY; --preset offline needs none.`;

const options = {
  json: { type: "boolean" },
  config: { type: "string" },
  preset: { type: "string" },
  models: { type: "string" },
  cases: { type: "string" },
  samples: { type: "string" },
  transports: { type: "string" },
  transport: { type: "string" },
  split: { type: "string" },
  budget: { type: "string" },
  spec: { type: "string" },
  estimate: { type: "boolean" },
  base: { type: "string" },
  model: { type: "string" },
  tier: { type: "string" },
  case: { type: "string" },
  limit: { type: "string" },
  rounds: { type: "string" },
  batch: { type: "string" },
  from: { type: "string" },
  n: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

type Values = ReturnType<
  typeof parseArgs<{ options: typeof options; allowPositionals: true }>
>["values"];

async function loadConfig(file?: string): Promise<EvalConfig> {
  const path = resolve(file ?? `${TOOL_ROOT}eval.config.ts`);
  const module = (await import(pathToFileURL(path).href)) as {
    default: EvalConfig;
  };
  return module.default;
}

const list = (value?: string) =>
  value
    ? value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
/** A non-negative number from a flag, or undefined when the flag is not set. Throws on anything else. */
export const num = (value: string | undefined, name: string) => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0)
    throw new Error(`--${name} must be a number, got "${value}"`);
  return n;
};

function planOf(config: EvalConfig, values: Values) {
  const transports = list(values.transports) as Transport[] | undefined;
  for (const t of transports ?? []) {
    if (!TRANSPORTS.includes(t)) throw new Error(`Unknown transport "${t}"`);
  }
  return resolvePlan(config, values.preset ?? "full", {
    models: list(values.models),
    cases: values.cases as Preset["cases"] | undefined,
    samples: num(values.samples, "samples"),
    transports,
  });
}

function print(values: Values, json: unknown, text: string) {
  process.stdout.write(
    values.json ? `${JSON.stringify(json, null, 2)}\n` : `${text}\n`,
  );
}

async function commandRun(config: EvalConfig, values: Values) {
  const plan = planOf(config, values);
  const split = (values.split ?? "both") as "both" | "train" | "heldout";
  if (!["both", "train", "heldout"].includes(split))
    throw new Error(`--split must be both, train or heldout`);
  const spec = values.spec ? loadSpec(values.spec) : undefined;
  const budgetUsd = num(values.budget, "budget") ?? config.budgetUsd;
  const splits: Array<"train" | "heldout"> =
    split === "both" ? ["train", "heldout"] : [split];
  const caseCount = splits.reduce(
    (n, s) => n + selectCases(loadCases(s), plan.cases).length,
    0,
  );
  const estimate = estimateRun({ config, plan, spec, caseCount });
  const samples =
    caseCount * plan.models.length * plan.transports.length * plan.samples;
  process.stderr.write(
    `${samples} samples (${caseCount} cases × ${plan.models.length} models × ${plan.transports.length} transports × ${plan.samples}), estimated $${estimate.toFixed(2)}, budget $${budgetUsd.toFixed(2)}\n`,
  );
  if (values.estimate)
    return print(
      values,
      { samples, estimatedCostUsd: estimate, budgetUsd },
      "",
    );
  const run = await runEval({
    config,
    plan,
    split,
    budgetUsd,
    spec,
    specFile: values.spec,
    onProgress: values.json
      ? undefined
      : (done, total, s) =>
          process.stderr.write(
            `\r${done}/${total}  ${s.model} ${s.transport} ${s.case}`.padEnd(
              70,
            ),
          ),
  });
  if (!values.json) process.stderr.write("\n");
  const report = buildReport(readRun(run.id));
  print(values, report, formatReport(report));
}

function commandReport(values: Values, positionals: string[]) {
  const data = readRun(positionals[0] ?? "latest");
  const base = values.base ? readRun(values.base) : undefined;
  const report = buildReport(data, base);
  print(values, report, formatReport(report));
}

function commandFailures(values: Values, positionals: string[]) {
  const { samples } = readRun(positionals[0] ?? "latest");
  if (values.tier && !TIERS.includes(values.tier as Tier))
    throw new Error(`Unknown tier "${values.tier}"`);
  const messages = Object.fromEntries(
    loadCases("train").map((c) => [c.id, c.message]),
  );
  const rows = failures(samples, {
    model: values.model,
    tier: values.tier as Tier | undefined,
    case: values.case,
    limit: num(values.limit, "limit"),
  }).map((row) => ({ ...row, message: messages[row.case] }));
  const text = rows
    .map(
      (r) =>
        `── ${r.case} · ${r.model} · ${r.transport} #${r.sample}\nrequest: ${r.message}\n${Object.entries(
          r.failed,
        )
          .map(
            ([tier, reasons]) => `${tier}: ${(reasons as string[]).join("; ")}`,
          )
          .join(
            "\n",
          )}\nreply:\n${r.reply || JSON.stringify(r.toolCalls).slice(0, 2000)}\n`,
    )
    .join("\n");
  print(values, rows, text || "no failing training samples");
}

function commandPrompt(values: Values) {
  const spec = values.spec ? loadSpec(values.spec) : undefined;
  const prompts = renderedPrompts(spec);
  const transport = values.transport as Transport | undefined;
  if (transport && !TRANSPORTS.includes(transport))
    throw new Error(`Unknown transport "${transport}"`);
  const shown: Record<string, string> = transport
    ? { [transport]: prompts[transport] }
    : prompts;
  print(
    values,
    shown,
    Object.entries(shown)
      .map(
        ([t, text]) =>
          `===== ${t} (~${Math.ceil(text.length / 4)} tokens) =====\n${text}`,
      )
      .join("\n"),
  );
}

function commandLabel(values: Values, positionals: string[]) {
  const { run, samples } = readRun(positionals[0] ?? "latest");
  const n = num(values.n, "n") ?? 20;
  // Training samples the judge graded, spread over the judge's scores.
  const graded = samples
    .filter((s) => s.split === "train" && s.tiers.judgement.score != null)
    .sort(
      (a, b) => (a.tiers.judgement.score ?? 0) - (b.tiers.judgement.score ?? 0),
    );
  const step = Math.max(1, Math.floor(graded.length / n));
  const picked = graded.filter((_, i) => i % step === 0).slice(0, n);
  const messages = Object.fromEntries(
    loadCases("train").map((c) => [c.id, c.message]),
  );
  const rows: LabelRow[] = picked.map((s) => ({
    key: `${s.case}|${s.model}|${s.transport}|${s.sample}`,
    case: s.case,
    message: messages[s.case] ?? "",
    reply: s.output.text,
    surfaces: s.output.toolCalls.length
      ? JSON.stringify(s.output.toolCalls)
      : "",
    judge: {
      judgement: s.tiers.judgement.score ?? null,
      quality: s.tiers.quality.score ?? null,
    },
    human: { judgement: null, quality: null },
  }));
  const dir = `${TOOL_ROOT}labels/`;
  mkdirSync(dir, { recursive: true });
  const file = `${dir}${run.id}.jsonl`;
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  print(
    values,
    { file, rows: rows.length },
    `wrote ${rows.length} samples to ${file}\nset "human" to 0 or 1 for judgement and quality, then: genui-eval calibrate ${file}`,
  );
}

function commandCalibrate(values: Values, positionals: string[]) {
  if (!positionals[0]) throw new Error("calibrate needs a labels file");
  const result = calibrate(readLabels(positionals[0]));
  const line = (tier: "judgement" | "quality") => {
    const r = result[tier];
    return r.agreement === null
      ? `${tier}: no labels`
      : `${tier}: ${(r.agreement * 100).toFixed(0)}% agreement over ${r.labelled} labels ${r.agreement >= 0.8 ? "(ok)" : "(below 80%: refine the rubric before trusting the judge)"}`;
  };
  print(values, result, `${line("judgement")}\n${line("quality")}`);
}

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    options,
    allowPositionals: true,
  });
  const [command, ...rest] = positionals;
  if (!command || values.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const config = await loadConfig(values.config);
  switch (command) {
    case "run":
      return commandRun(config, values);
    case "report":
      return commandReport(values, rest);
    case "failures":
      return commandFailures(values, rest);
    case "prompt":
      return commandPrompt(values);
    case "label":
      return commandLabel(values, rest);
    case "calibrate":
      return commandCalibrate(values, rest);
    case "optimize": {
      const { commandOptimize } = await import("./optimize-cli");
      return commandOptimize(config, values, planOf(config, values));
    }
    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`genui-eval: ${(error as Error).message}\n`);
    process.exit(1);
  });
}

export type { Values };
