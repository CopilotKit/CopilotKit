import { json, preflight } from "@/skins/ledgerline/learning/http";
import { addImports, listImports } from "@/eval-platform/imports-store";
import type { ImportInput } from "@/eval-platform/imports-store";

/**
 * The customer's eval platform (the `/eval-platform` stand-in) receiving eval
 * candidates exported from CopilotKit Intelligence.
 * GET: the imported cases. POST `{ cases: [{ id, query, checks, sourceTrajectoryIds }] }`.
 */
export const dynamic = "force-dynamic";

export const GET = () => json({ imported: listImports() });

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(
      { error: "BAD_REQUEST", message: "Expected a JSON body." },
      400,
    );
  }
  const cases = (payload as { cases?: unknown }).cases;
  const valid =
    Array.isArray(cases) &&
    cases.length > 0 &&
    cases.every(
      (c) =>
        c &&
        typeof (c as ImportInput).id === "string" &&
        typeof (c as ImportInput).query === "string" &&
        Array.isArray((c as ImportInput).checks),
    );
  if (!valid) {
    return json(
      {
        error: "BAD_REQUEST",
        message:
          "Expected { cases: [{ id, query, checks }] } with at least one case.",
      },
      400,
    );
  }
  const added = addImports(cases as ImportInput[]);
  return json({
    imported: added,
    total: listImports().length,
    platform: "Benchline Evals",
  });
}

export const OPTIONS = preflight;
