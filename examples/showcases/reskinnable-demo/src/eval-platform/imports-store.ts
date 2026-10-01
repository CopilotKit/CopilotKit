/**
 * Cases imported into the customer's eval platform (the `/eval-platform` stand-in)
 * from CopilotKit Intelligence's "Export to your eval platform". In memory, pinned on
 * `globalThis` so every route bundle shares one list; `POST /api/learning/v1/reset`
 * clears it.
 */
export interface ImportedEvalCase {
  readonly id: string;
  readonly sourceCandidateId: string;
  readonly query: string;
  readonly checks: readonly string[];
  readonly sourceTrajectoryIds: readonly string[];
  readonly importedAt: number;
  readonly source: "copilotkit-intelligence";
  readonly status: "not_run";
}

export interface ImportInput {
  readonly id: string;
  readonly query: string;
  readonly checks: readonly string[];
  readonly sourceTrajectoryIds?: readonly string[];
}

const KEY = Symbol.for("reskinnable-demo.eval-platform.imports");
type Pinned = typeof globalThis & { [KEY]?: ImportedEvalCase[] };

function list(): ImportedEvalCase[] {
  const g = globalThis as Pinned;
  g[KEY] ??= [];
  return g[KEY];
}

export function listImports(): readonly ImportedEvalCase[] {
  return list();
}

/** Adds candidates as new cases; a candidate already imported is updated in place, not duplicated. */
export function addImports(
  inputs: readonly ImportInput[],
  now = Date.now(),
): readonly ImportedEvalCase[] {
  const cases = list();
  const added: ImportedEvalCase[] = [];
  for (const input of inputs) {
    const row: ImportedEvalCase = {
      id: `imp_${input.id}`,
      sourceCandidateId: input.id,
      query: input.query,
      checks: [...input.checks],
      sourceTrajectoryIds: [...(input.sourceTrajectoryIds ?? [])],
      importedAt: now,
      source: "copilotkit-intelligence",
      status: "not_run",
    };
    const at = cases.findIndex((c) => c.sourceCandidateId === input.id);
    if (at >= 0) cases[at] = row;
    else cases.unshift(row);
    added.push(row);
  }
  return added;
}

export function clearImports(): void {
  (globalThis as Pinned)[KEY] = [];
}
