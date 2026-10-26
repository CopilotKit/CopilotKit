import type { EvalCase } from "./cases";
import type { SampleOutput } from "./harness";
import type { SurfaceCheck } from "./render-check";

/** The result of one tier for one sample. */
export interface TierResult {
  pass: boolean;
  /** Why it failed, one short reason per problem. Empty when it passed. */
  reasons: string[];
}

export interface CodeScores {
  /** It parses, follows A2UI 1.0 and renders. */
  validity: TierResult;
  /** It uses the catalog correctly: no rejected operation, no invalid props, the expected components. */
  fidelity: TierResult;
  /** The code part of judgement: UI when the case wants UI, no prose-only surface. */
  judgement: TierResult;
}

const tier = (reasons: string[]): TierResult => ({
  pass: reasons.length === 0,
  reasons,
});

/**
 * Scores what code can decide. Reasons are short and stable ("invalid
 * props: value: Expected number, received string"), so reports can group
 * them.
 */
export function scoreCode(
  c: EvalCase,
  out: SampleOutput,
  checks: SurfaceCheck[],
): CodeScores {
  const validity: string[] = [];
  if (out.error) validity.push(`run error: ${out.error}`);
  validity.push(...out.parseErrors.map((e) => e.replace(/: .*/, "")));
  for (const check of checks) {
    if (check.crash) validity.push(`render crash: ${check.crash}`);
    else if (!check.rendered) validity.push("surface did not render (no root)");
  }

  const fidelity: string[] = [];
  for (const rejected of out.rejected) {
    fidelity.push(`rejected by runtime: ${rejected.reason}`);
  }
  for (const check of checks) {
    for (const rejected of check.rejected)
      fidelity.push(`rejected by client: ${rejected}`);
    for (const error of check.errors) fidelity.push(error.message);
  }
  const used = new Set(checks.flatMap((check) => check.components));
  if (c.expect.ui) {
    for (const name of c.expect.components ?? []) {
      if (!used.has(name))
        fidelity.push(`expected component not used: ${name}`);
    }
  }

  const judgement: string[] = [];
  const hasUI = out.surfaces.length > 0;
  if (c.expect.ui && !hasUI) judgement.push("no UI where UI helps");
  if (!c.expect.ui && hasUI) judgement.push("UI where prose alone is right");
  if (checks.some((check) => check.proseOnly))
    judgement.push("surface with prose only");

  return {
    validity: tier(validity),
    fidelity: tier(fidelity),
    judgement: tier(judgement),
  };
}
