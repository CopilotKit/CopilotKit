import { num } from "./cli";
import type { Values } from "./cli";
import type { EvalConfig, ResolvedPlan } from "./config";
import { optimize } from "./optimize";
import { loadSpec } from "./spec";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** `genui-eval optimize`: the search, then the leaderboard. */
export async function commandOptimize(
  config: EvalConfig,
  values: Values,
  plan: ResolvedPlan,
) {
  const budgetUsd = num(values.budget, "budget") ?? config.budgetUsd;
  const result = await optimize({
    config,
    plan,
    budgetUsd,
    rounds: num(values.rounds, "rounds") ?? 20,
    batchSize: num(values.batch, "batch") ?? 6,
    from: values.from ? loadSpec(values.from) : undefined,
    log: values.json ? undefined : (line) => process.stderr.write(`${line}\n`),
  });
  if (values.json) {
    process.stdout.write(
      `${JSON.stringify({ outDir: result.outDir, spentUsd: result.spentUsd, winner: result.winner?.id, leaderboard: result.leaderboard }, null, 2)}\n`,
    );
    return;
  }
  const lines = [
    `spent $${result.spentUsd.toFixed(2)}   results in ${result.outDir}`,
    "",
  ];
  lines.push(
    "candidate  origin      train    held-out              tokens md/tool   accepted",
  );
  for (const c of result.leaderboard) {
    const held = c.heldout
      ? `${pct(c.heldout.overall)} [${pct(c.heldout.low)}-${pct(c.heldout.high)}]`
      : "–";
    lines.push(
      `${c.id.padEnd(11)}${c.origin.padEnd(12)}${pct(c.trainScore).padEnd(9)}${held.padEnd(22)}${`${c.promptTokens.markdown ?? "–"}/${c.promptTokens.tool ?? "–"}`.padEnd(17)}${c.accepted ? (c.accepted.ok ? "yes" : `no: ${c.accepted.reasons.join("; ")}`) : ""}`,
    );
  }
  lines.push("");
  lines.push(
    result.winner
      ? `winner ${result.winner.id}: ${result.outDir}winner.spec.json (prompt: winner.prompt.md, diff: winner.diff). Copy it into the builders and the catalog descriptions, then confirm with a plain run.`
      : "no candidate passed the acceptance rule; the prompts that ship stay.",
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}
