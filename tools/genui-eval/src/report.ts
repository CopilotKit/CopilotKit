import type { Transport } from "./config";
import { TIERS } from "./results";
import type { RunRecord, SampleRecord, Tier } from "./results";
import { clearlyDifferent, wilson } from "./stats";
import type { Rate } from "./stats";

export type TierRates = Record<Tier, Rate>;

/** The pass rate of each tier over some samples. A sample a tier could not grade is left out of that tier. */
export function tierRates(samples: readonly SampleRecord[]): TierRates {
  return Object.fromEntries(
    TIERS.map((tier) => {
      const graded = samples.filter((s) => s.tiers[tier].pass !== null);
      return [
        tier,
        wilson(graded.filter((s) => s.tiers[tier].pass).length, graded.length),
      ];
    }),
  ) as TierRates;
}

/**
 * One number for a set of samples: the mean pass rate of validity, fidelity
 * and judgement. A tier with no graded sample is left out; `null` when none
 * has one.
 */
export function overallScore(rates: TierRates) {
  const graded = [rates.validity, rates.fidelity, rates.judgement]
    .map((r) => r.rate)
    .filter((r): r is number => r !== null);
  return graded.length ? mean(graded) : null;
}

/** A reason without the parts that differ per sample, so the same problem groups together. */
export function reasonKey(reason: string) {
  return reason
    .replace(/"[^"]{0,80}"/g, '"…"')
    .replace(/\b\d+(\.\d+)?\b/g, "N")
    .slice(0, 140);
}

export interface ModelReport {
  model: string;
  modelName: string;
  hosts: string[];
  /** Training samples, by tier. */
  train: TierRates;
  /** Training samples, by transport and tier. */
  byTransport: Partial<Record<Transport, TierRates>>;
  /** Held-out samples: totals only. */
  heldout?: TierRates;
  /** The most common failure reasons (training samples only). */
  topFailures: Array<{ reason: string; count: number }>;
  promptTokens: Partial<Record<Transport, number>>;
  /** Samples cut at the output token cap: their validity is ungraded. */
  cut: number;
  costUsd: number;
  costPerValidSurfaceUsd: number | null;
}

export interface Report {
  run: Pick<
    RunRecord,
    | "id"
    | "preset"
    | "gitSha"
    | "dirtyHash"
    | "promptHashes"
    | "promptSizes"
    | "stopped"
    | "spec"
    | "judge"
  >;
  models: ModelReport[];
  /** The weakest tags (training samples), by overall score. */
  weakestTags: Array<{ tag: string; score: number; samples: number }>;
  totals: {
    samples: number;
    costUsd: number;
    overall: number | null;
    heldoutOverall: number | null;
  };
  base?: {
    id: string;
    /** Rate differences, this run minus the base, per model and tier. */
    delta: Array<{
      model: string;
      split: "train" | "heldout";
      tier: Tier;
      delta: number;
      clear: boolean;
    }>;
    promptSizes: RunRecord["promptSizes"];
    /** Why the two runs may not compare like for like. */
    warnings: string[];
  };
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

function modelReport(
  model: string,
  samples: SampleRecord[],
  transports: Transport[],
): ModelReport {
  const train = samples.filter((s) => s.split === "train");
  const heldout = samples.filter((s) => s.split === "heldout");
  const counts = new Map<string, number>();
  for (const s of train) {
    for (const tier of TIERS) {
      // An ungraded tier (judge failed, reply cut) keeps its reasons for the record only.
      if (s.tiers[tier].pass !== false) continue;
      for (const reason of s.tiers[tier].reasons) {
        const key = `${tier}: ${reasonKey(reason)}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const valid = samples.filter((s) => s.surfaces > 0 && s.tiers.validity.pass);
  const validSurfaces = valid.reduce((sum, s) => sum + s.surfaces, 0);
  const cost = samples.reduce((sum, s) => sum + s.costUsd + s.judgeCostUsd, 0);
  return {
    model,
    modelName: samples[0]?.modelName ?? model,
    hosts: [
      ...new Set(samples.map((s) => s.host).filter((h): h is string => !!h)),
    ],
    train: tierRates(train),
    byTransport: Object.fromEntries(
      transports.map((t) => [
        t,
        tierRates(train.filter((s) => s.transport === t)),
      ]),
    ),
    ...(heldout.length > 0 ? { heldout: tierRates(heldout) } : {}),
    topFailures: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count })),
    promptTokens: Object.fromEntries(
      transports.map((t) => [
        t,
        Math.round(
          mean(
            samples.filter((s) => s.transport === t).map((s) => s.promptTokens),
          ),
        ),
      ]),
    ),
    cut: samples.filter((s) => s.cut).length,
    costUsd: cost,
    costPerValidSurfaceUsd: validSurfaces > 0 ? cost / validSurfaces : null,
  };
}

/**
 * The report of a run: per model, the pass rate of each tier with its
 * interval, the main failures, prompt tokens and cost. Held-out samples
 * appear only as totals. With a base run, the differences.
 */
export function buildReport(
  data: { run: RunRecord; samples: SampleRecord[] },
  base?: { run: RunRecord; samples: SampleRecord[] },
): Report {
  const { run, samples } = data;
  const ids = [...new Set(samples.map((s) => s.model))];
  const models = ids.map((id) =>
    modelReport(
      id,
      samples.filter((s) => s.model === id),
      run.transports,
    ),
  );
  const train = samples.filter((s) => s.split === "train");
  const heldout = samples.filter((s) => s.split === "heldout");
  const tags = [...new Set(train.flatMap((s) => s.tags))];
  const report: Report = {
    run: {
      id: run.id,
      preset: run.preset,
      gitSha: run.gitSha,
      ...(run.dirtyHash ? { dirtyHash: run.dirtyHash } : {}),
      promptHashes: run.promptHashes,
      promptSizes: run.promptSizes,
      ...(run.stopped ? { stopped: run.stopped } : {}),
      ...(run.spec ? { spec: run.spec } : {}),
      judge: run.judge,
    },
    models,
    weakestTags: tags
      .flatMap((tag) => {
        const tagged = train.filter((s) => s.tags.includes(tag));
        const score = overallScore(tierRates(tagged));
        return score === null ? [] : [{ tag, score, samples: tagged.length }];
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 5),
    totals: {
      samples: samples.length,
      costUsd: samples.reduce((sum, s) => sum + s.costUsd + s.judgeCostUsd, 0),
      overall: overallScore(tierRates(train)),
      heldoutOverall: overallScore(tierRates(heldout)),
    },
  };
  if (base) {
    // Only the (model, split, case, transport) groups both runs have, so a
    // stopped run or another case selection does not change the mix.
    const group = (s: SampleRecord) =>
      `${s.model}|${s.split}|${s.case}|${s.transport}`;
    const theirGroups = new Set(base.samples.map(group));
    const shared = new Set(
      samples.map(group).filter((g) => theirGroups.has(g)),
    );
    const caseSet = (xs: readonly SampleRecord[]) =>
      new Set(xs.map((s) => `${s.split}|${s.case}`));
    const myCases = caseSet(samples);
    const theirCases = caseSet(base.samples);
    const warnings: string[] = [];
    for (const r of [run, base.run]) {
      if (r.stopped) warnings.push(`run ${r.id} stopped early (${r.stopped})`);
    }
    if (run.judge !== base.run.judge) {
      warnings.push(
        `the runs used different judges (${run.judge} vs ${base.run.judge})`,
      );
    }
    const bothCases = [...myCases].filter((c) => theirCases.has(c));
    if (
      bothCases.length !== myCases.size ||
      bothCases.length !== theirCases.size
    ) {
      warnings.push(
        `the runs cover different cases: compared on the ${bothCases.length} both have`,
      );
    }
    const delta: NonNullable<Report["base"]>["delta"] = [];
    for (const id of ids) {
      for (const split of ["train", "heldout"] as const) {
        const pick = (xs: readonly SampleRecord[]) =>
          xs.filter(
            (s) => s.model === id && s.split === split && shared.has(group(s)),
          );
        const mine = pick(samples);
        const theirs = pick(base.samples);
        if (mine.length === 0 || theirs.length === 0) continue;
        const a = tierRates(mine);
        const b = tierRates(theirs);
        for (const tier of TIERS) {
          const [ra, rb] = [a[tier].rate, b[tier].rate];
          // An empty tier on either side has nothing to compare.
          if (ra === null || rb === null) continue;
          delta.push({
            model: id,
            split,
            tier,
            delta: ra - rb,
            clear: clearlyDifferent(a[tier], b[tier]),
          });
        }
      }
    }
    report.base = {
      id: base.run.id,
      delta,
      promptSizes: base.run.promptSizes,
      warnings,
    };
  }
  return report;
}

const pct = (r: Rate) =>
  r.rate === null
    ? "   –      "
    : `${(r.rate * 100).toFixed(0).padStart(3)}% ±${(((r.high - r.low) / 2) * 100).toFixed(0).padStart(2)}`;

/** The report as text for a terminal. */
export function formatReport(report: Report): string {
  const lines: string[] = [];
  const r = report.run;
  lines.push(
    `run ${r.id}  preset ${r.preset}  git ${r.gitSha.slice(0, 10)}${r.dirtyHash ? ` (+changes ${r.dirtyHash})` : ""}${r.spec ? `  spec ${r.spec}` : ""}${r.stopped ? `  STOPPED: ${r.stopped}` : ""}`,
  );
  lines.push(
    `prompt tokens  ${Object.entries(r.promptSizes)
      .map(([t, n]) => `${t} ${n}`)
      .join("  ")}${
      report.base
        ? `   (base: ${Object.entries(report.base.promptSizes)
            .map(([t, n]) => `${t} ${n}`)
            .join("  ")})`
        : ""
    }`,
  );
  lines.push("");
  lines.push("training cases");
  lines.push(
    `${"model".padEnd(10)}${TIERS.map((t) => t.padEnd(12)).join("")}${"tokens md/tool".padEnd(16)}$/valid surface`,
  );
  for (const m of report.models) {
    const tokens = `${m.promptTokens.markdown ?? "–"}/${m.promptTokens.tool ?? "–"}`;
    lines.push(
      `${m.model.padEnd(10)}${TIERS.map((t) => pct(m.train[t]).padEnd(12)).join("")}${tokens.padEnd(16)}${m.costPerValidSurfaceUsd === null ? "–" : m.costPerValidSurfaceUsd.toFixed(4)}`,
    );
  }
  if (report.models.some((m) => m.heldout)) {
    lines.push("");
    lines.push("held-out cases (totals only)");
    for (const m of report.models) {
      if (!m.heldout) continue;
      lines.push(
        `${m.model.padEnd(10)}${TIERS.map((t) => pct(m.heldout![t]).padEnd(12)).join("")}`,
      );
    }
  }
  lines.push("");
  const share = (x: number | null) =>
    x === null ? "–" : `${(x * 100).toFixed(1)}%`;
  lines.push(
    `overall (train) ${share(report.totals.overall)}${report.totals.heldoutOverall === null ? "" : `   held-out ${share(report.totals.heldoutOverall)}`}   samples ${report.totals.samples}   cost $${report.totals.costUsd.toFixed(2)}`,
  );
  for (const m of report.models) {
    if (m.cut > 0) {
      lines.push(
        `${m.model}: ${m.cut} replies cut at the output token cap (validity ungraded)`,
      );
    }
  }
  for (const m of report.models) {
    if (m.topFailures.length === 0) continue;
    lines.push("");
    lines.push(
      `top failures (${m.model}${m.hosts.length ? ` via ${m.hosts.join(", ")}` : ""}):`,
    );
    for (const f of m.topFailures)
      lines.push(`  ${String(f.count).padStart(3)}× ${f.reason}`);
  }
  if (report.weakestTags.length > 0) {
    lines.push("");
    lines.push(
      `weakest tags: ${report.weakestTags.map((t) => `${t.tag} ${(t.score * 100).toFixed(0)}%`).join(" · ")}`,
    );
  }
  if (report.base) {
    const changed = report.base.delta.filter((d) => Math.abs(d.delta) >= 0.005);
    lines.push("");
    lines.push(
      `vs base ${report.base.id}${changed.length === 0 ? ": no change" : ":"}`,
    );
    for (const w of report.base.warnings) lines.push(`  warning: ${w}`);
    for (const d of changed) {
      lines.push(
        `  ${d.model.padEnd(10)}${d.split.padEnd(9)}${d.tier.padEnd(11)}${d.delta > 0 ? "+" : ""}${(d.delta * 100).toFixed(1)} pts${d.clear ? "  (clear)" : ""}`,
      );
    }
  }
  return lines.join("\n");
}

export interface FailureFilters {
  model?: string;
  tier?: Tier;
  case?: string;
  limit?: number;
}

/**
 * The failing training samples, with what an agent needs to fix the prompt:
 * the request, the reasons, the reply. Held-out samples are never listed.
 */
export function failures(
  samples: readonly SampleRecord[],
  filters: FailureFilters = {},
) {
  return samples
    .filter((s) => s.split === "train")
    .filter((s) => !filters.model || s.model === filters.model)
    .filter((s) => !filters.case || s.case === filters.case)
    .map((s) => {
      const tiers = (filters.tier ? [filters.tier] : TIERS).filter(
        (t) => s.tiers[t].pass === false,
      );
      return { sample: s, tiers };
    })
    .filter(({ tiers }) => tiers.length > 0)
    .slice(0, filters.limit ?? 20)
    .map(({ sample, tiers }) => ({
      case: sample.case,
      model: sample.model,
      transport: sample.transport,
      sample: sample.sample,
      failed: Object.fromEntries(
        tiers.map((t) => [t, sample.tiers[t].reasons]),
      ),
      reply: sample.output.text.slice(0, 4000),
      toolCalls: sample.output.toolCalls,
      parseErrors: sample.output.parseErrors,
    }));
}
