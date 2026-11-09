import type { NextRequest } from "next/server";
import * as store from "@/skins/commerce/data/store";
import { errorResponse } from "@/skins/commerce/data/http";

/**
 * BEAT 3d — the durable artifact.
 *
 * A restock plan is written to the STORE, so it belongs to the application and
 * not to the conversation that produced it. That is the whole point of the beat:
 * delete the thread, reload the browser, and the plan is still sitting on the
 * Catalog page. Nothing here references a thread id.
 */
export const GET = async () => Response.json(store.plans());

// ── Row budgets ──────────────────────────────────────────────────────────────
// These caps are a LAYOUT budget, not a whim: a plan renders as ONE card in a
// two-column grid (`skins/commerce/pages/catalog.tsx`), and three bullets, eight
// SKU rows and eight schedule steps is what fits before the card stops being
// readable. `createRestockPlan`'s own schema already declares `highlights.max(3)`.
//
// Over-budget input is REFUSED, never trimmed. The trim this replaced was silent
// in the one place silence is unaffordable: the tool answered "Filed the plan",
// the agent narrated the twelve SKUs it had read out of the price sheet, and the
// artifact on the page held eight rows — a discrepancy nobody in the room can
// see, in a record that outlives the thread. A refusal names the limit, so the
// agent re-files a plan that fits instead of storing one that lies.
const MAX_HIGHLIGHTS = 3;
const MAX_LINES = 8;
const MAX_SCHEDULE = 8;

/** Landed cost per unit, in dollars. A restock plan is a PO, not a bond issue. */
const MAX_LANDED_COST = 1_000_000;
/** Units on a single line of a single plan. */
const MAX_UNITS = 10_000_000;

/**
 * The codes this route can refuse with.
 *
 * Deliberately RETURNED rather than thrown. `errorResponse` (`data/http.ts`)
 * resolves a thrown code through a closed `Map` and answers a logged **500** for
 * anything it does not recognise — correct for a store invariant, wrong for "the
 * model sent me a bad row", which is a 4xx the agent can act on. It also needs a
 * FIELD-SPECIFIC message so the retry is informed, and the shared map only
 * carries one fixed string per code. The `{ error, message }` envelope is
 * identical either way, so callers see one shape.
 */
type PlanRejection = "BAD_REQUEST" | "INVALID_PLAN_FIELD" | "PLAN_TOO_LARGE";

class PlanInputError extends Error {
  constructor(
    readonly code: PlanRejection,
    readonly detail: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "PlanInputError";
  }
}

const reject = (error: PlanRejection, message: string, status: number) =>
  Response.json({ error, message }, { status });

/** Refuse one field, naming it, so the agent's retry is informed. */
function invalid(detail: string): never {
  throw new PlanInputError("INVALID_PLAN_FIELD", detail, 422);
}

/**
 * A trimmed, non-empty string — or a refusal.
 *
 * `String(value)` is never used on model-authored input: it renders `null` as
 * `"null"` and `{}` as `"[object Object]"`, both of which are truthy, survive a
 * `.filter(Boolean)`, and land in the durable artifact verbatim.
 */
function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    invalid(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

/**
 * A number the artifact can be reasoned about with.
 *
 * `Number(x) || 0` is never used: it mapped `NaN`, `"$52"`, `null` AND a genuine
 * `0` onto the same stored `0`, so a cost the agent failed to parse was
 * indistinguishable from a cost that really is zero — in the very figures the
 * margin narrative is built on. A genuine `0` is accepted here and stored as
 * `0`; anything unparseable, negative or absurd is refused.
 */
function requireNumber(
  value: unknown,
  field: string,
  max: number,
  { integer = false }: { integer?: boolean } = {},
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(`${field} must be a finite number.`);
  }
  if (integer && !Number.isInteger(value)) {
    invalid(`${field} must be a whole number.`);
  }
  if (value < 0 || value > max) {
    invalid(`${field} must be between 0 and ${max}.`);
  }
  return value;
}

/**
 * An absent list is empty; a present one must be a list, and must fit.
 *
 * `Array.isArray(x) ? … : []` was the same coerce-and-continue decision as the
 * trim: a `highlights` the model sent as a single string became an empty section
 * on the card, with success reported.
 */
function requireList(value: unknown, field: string, max: number): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    invalid(`${field} must be an array.`);
  }
  if (value.length > max) {
    throw new PlanInputError(
      "PLAN_TOO_LARGE",
      `A plan holds at most ${max} ${field}; ${value.length} were sent. File a plan that fits rather than one that is silently shorter than the document.`,
      422,
    );
  }
  return value;
}

/**
 * The Catalog card keys its React lists off these very values (`key={highlight}`,
 * `key={line.sku}`, `` key={`${step.week}-${step.item}`} ``), so a repeated value
 * is not merely redundant — React renders one row where the plan holds two, and
 * the card quietly shows less than the record contains.
 */
function requireDistinct(keys: string[], field: string): void {
  if (new Set(keys).size !== keys.length) {
    invalid(`${field} must not repeat; the page keys its rows off them.`);
  }
}

/**
 * Absent → the documented default. PRESENT → it has to be usable.
 *
 * `String(body.season ?? "Unscheduled").trim()` let an explicit `""` through and
 * stored a blank season: a card with no title, and a receipt reading "Filed the
 * restock plan for …" with a double space where the season should be. Omitting
 * the field is a choice we can default; sending an empty one is a mistake we
 * cannot tell apart from a parse failure.
 */
function optionalText(value: unknown, field: string, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  return requireText(value, field);
}

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();

    // `typeof === "string"`, not `String(...)`: `{ vendor: {} }` used to pass
    // this check as the literal text "[object Object]".
    const vendor = typeof body?.vendor === "string" ? body.vendor.trim() : "";
    const summary =
      typeof body?.summary === "string" ? body.summary.trim() : "";
    if (!vendor || !summary) {
      return reject("BAD_REQUEST", "A plan needs a vendor and a summary.", 400);
    }

    // Validate the model-authored fields rather than coercing them. The agent
    // fills these from an uploaded PDF against a zod schema, so a malformed row
    // does not mean "documents are messy" — it means the model misread the
    // sheet, which is exactly when a quietly thinner artifact is worst.
    const highlights = requireList(
      body?.highlights,
      "highlights",
      MAX_HIGHLIGHTS,
    ).map((h, i) => requireText(h, `highlights[${i}]`));
    requireDistinct(highlights, "highlights");

    const lines = requireList(body?.lines, "lines", MAX_LINES).map((raw, i) => {
      const line = requireRecord(raw, `lines[${i}]`);
      return {
        sku: requireText(line.sku, `lines[${i}].sku`),
        name: requireText(line.name, `lines[${i}].name`),
        landedCost: requireNumber(
          line.landedCost,
          `lines[${i}].landedCost`,
          MAX_LANDED_COST,
        ),
        units: requireNumber(line.units, `lines[${i}].units`, MAX_UNITS, {
          integer: true,
        }),
      };
    });
    requireDistinct(
      lines.map((l) => l.sku),
      "lines[].sku",
    );

    const schedule = requireList(body?.schedule, "schedule", MAX_SCHEDULE).map(
      (raw, i) => {
        const step = requireRecord(raw, `schedule[${i}]`);
        return {
          week: requireText(step.week, `schedule[${i}].week`),
          item: requireText(step.item, `schedule[${i}].item`),
        };
      },
    );
    requireDistinct(
      schedule.map((s) => `${s.week}-${s.item}`),
      "schedule",
    );

    const plan = store.filePlan({
      vendor,
      season: optionalText(body?.season, "season", "Unscheduled"),
      summary,
      highlights,
      lines,
      schedule,
      filedBy: optionalText(body?.filedBy, "filedBy", "Bellwether"),
    });
    return Response.json(plan, { status: 201 });
  } catch (error) {
    if (error instanceof PlanInputError) {
      return reject(error.code, error.detail, error.status);
    }
    return errorResponse(error, "POST plans");
  }
};
