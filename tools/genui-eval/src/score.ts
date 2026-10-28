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

/** Every component a reply sent, with its props, across all operations. */
function sentComponents(out: SampleOutput) {
  return out.surfaces.flatMap((surface) =>
    (surface.operations as Array<Record<string, any>>).flatMap(
      (op) =>
        (op.createSurface?.components ??
          op.updateComponents?.components ??
          []) as Array<Record<string, unknown>>,
    ),
  );
}

/**
 * Whether the reply meets one expected entry. An entry is a component name
 * ("Image"), a component with a prop that is set ("EntityCard.image"), or
 * alternatives of those separated by "|": "Image|EntityCard.image" is a
 * photo either way.
 */
function meetsExpected(
  entry: string,
  used: ReadonlySet<string>,
  sent: ReadonlyArray<Record<string, unknown>>,
) {
  return entry.split("|").some((alternative) => {
    const [name, prop] = alternative.split(".");
    if (!used.has(name)) return false;
    if (!prop) return true;
    return sent.some(
      (component) =>
        component.component === name &&
        component[prop] !== undefined &&
        component[prop] !== null &&
        component[prop] !== "",
    );
  });
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
    for (const id of check.missing ?? []) {
      validity.push(`missing component: "${id}" is referenced but never sent`);
    }
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
  // With no UI at all, judgement already fails; fidelity grades the UI there is.
  if (c.expect.ui && out.surfaces.length > 0) {
    const sent = sentComponents(out);
    for (const entry of c.expect.components ?? []) {
      if (!meetsExpected(entry, used, sent))
        fidelity.push(`expected component not used: ${entry}`);
    }
  }

  const judgement: string[] = [];
  // A surface the reply deleted is not part of the UI the user ends up with.
  const hasUI =
    out.surfaces.length - checks.filter((check) => check.deleted).length > 0;
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
