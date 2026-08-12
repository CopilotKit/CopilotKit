import * as store from "@/skins/logistics/data/store";
import { laneCode } from "@/skins/logistics/data/rate-sheet-lanes";
import type { Lane, RateBriefLane } from "@/skins/logistics/data/types";

/**
 * BEAT 3d — the durable artifact.
 *
 * A rate brief is written to the STORE, so it belongs to the application and not
 * to the conversation that produced it. That is the whole point of the beat:
 * delete the thread, reload the browser, and the brief is still sitting on the
 * Decision Log page. Nothing here references a thread id.
 *
 * NOT the canvas brief. `renderBrief` (agent.ts → `build-brief-ops.ts`) emits
 * a2ui operations under `SURFACE_ID = "decision-brief"`; that is a render, it
 * lives on the canvas, and it dies with the thread. This route stores a record.
 */
export const GET = async () => Response.json(store.rateBriefs());

// ── Row budgets ──────────────────────────────────────────────────────────────
// A layout budget, not a whim: a rate brief renders as ONE card on the Decision
// Log, and eight lane rows and three impacts is what fits before the card stops
// being readable.
//
// Over-budget input is REFUSED, never trimmed. Commerce learned that the hard
// way on the same beat: the tool answered "filed", the agent narrated the twelve
// rows it had read out of the document, and the artifact held eight — a
// discrepancy nobody in the room can see, in a record that outlives the thread.
// A refusal names the limit, so the agent re-files a brief that fits instead of
// storing one that lies.
const MAX_LANE_RATES = 8;
const MAX_IMPACTS = 3;

/** Dollars per kilogram. A freight rate, not a bond issue. */
const MAX_RATE_USD_PER_KG = 1_000;

type BriefRejection = "BAD_REQUEST" | "INVALID_BRIEF_FIELD" | "BRIEF_TOO_LARGE";

class BriefInputError extends Error {
  constructor(
    readonly code: BriefRejection,
    readonly detail: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "BriefInputError";
  }
}

const reject = (error: BriefRejection, message: string, status: number) =>
  Response.json({ error, message }, { status });

/** Refuse one field, naming it, so the agent's retry is informed. */
function invalid(detail: string): never {
  throw new BriefInputError("INVALID_BRIEF_FIELD", detail, 422);
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
 * A rate the brief can be reasoned about with.
 *
 * `Number(x) || 0` is never used: it maps `NaN`, `"$0.45"`, `null` AND a genuine
 * `0` onto the same stored `0`, so a rate the agent failed to parse out of the
 * PDF would be indistinguishable from one the carrier really quoted — in the
 * very figures this artifact exists to carry.
 */
function requireRate(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(`${field} must be a finite number.`);
  }
  if (value < 0 || value > MAX_RATE_USD_PER_KG) {
    invalid(`${field} must be between 0 and ${MAX_RATE_USD_PER_KG}.`);
  }
  return value;
}

/**
 * A lane with no rate on file stays ABSENT, and only absent — and `0` IS absent.
 *
 * The fresh lane on the sheet is the row that proves the document was read, and
 * it has no prior rate. Storing that as `0` would put the brief's most
 * load-bearing row in a state three consumers read three different ways: the card
 * (`movementOf`) treats `<= 0` as "new lane", the readable emits
 * `old_rate_usd_per_kg: 0`, and the agent then says "$0.00 → $0.49" about a row
 * labelled "new lane". Folding it to absent at the door leaves ONE meaning.
 *
 * Unlike `newRateUsdPerKg`, no freight lane is genuinely free, so there is no
 * real `0` being lost — which is exactly why `requireRate` still accepts `0` for
 * the quoted rate and only this optional field folds it away.
 */
function optionalRate(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const rate = requireRate(value, field);
  return rate === 0 ? undefined : rate;
}

function requireList(value: unknown, field: string, max: number): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) invalid(`${field} must be an array.`);
  if (value.length > max) {
    throw new BriefInputError(
      "BRIEF_TOO_LARGE",
      `A rate brief holds at most ${max} ${field}; ${value.length} were sent. ` +
        `File a brief that fits rather than one that is silently shorter than ` +
        `the document.`,
      422,
    );
  }
  return value;
}

/**
 * The Decision Log keys its React lists off these values, so a repeat is not
 * merely redundant — React renders one row where the brief holds two, and the
 * card quietly shows less than the record contains.
 */
function requireDistinct(keys: string[], field: string): void {
  if (new Set(keys).size !== keys.length) {
    invalid(`${field} must not repeat; the page keys its rows off them.`);
  }
}

/**
 * One lane, normalized for comparison against the network. The model retypes
 * these out of a PDF, so case and stray spacing are noise, not signal.
 */
const laneKey = (lane: string, mode: string) =>
  `${lane.replace(/\s+/g, "").toUpperCase()}|${mode.trim().toLowerCase()}`;

/**
 * A prior rate is a LEDGER fact, so the ledger settles it — not the model.
 *
 * THE NEW rate is the document's own figure and only a reader of the attachment
 * knows it, so it stays model-authored: that is beat 3d's entire proof. THE PRIOR
 * rate is what Meridian already pays this carrier on that lane, which the app
 * knows authoritatively — so leaving it to the model is leaving a fact we hold to
 * a party that has to retype it out of a PDF. It goes wrong in three directions,
 * and all three put a claim in the durable artifact that the document contradicts:
 *
 *   - OVER-FILLED. Observed live: the agent copied the quoted $0.49 into the
 *     prior-rate slot for SHA-OAK — the one lane the sheet prints as "new" — and
 *     the card rendered "$0.49 → $0.49, flat" under a document that says there is
 *     no prior rate on file.
 *   - UNDER-FILLED. The mirror, and the same lie on the same row: omit the field
 *     for a lane the carrier DOES serve and `movementOf` in `rate-brief-log.tsx`
 *     labels it "new lane", telling the room the network has never carried a lane
 *     it carries.
 *   - WRONG. `{ lane: "SHA-LAX", oldRateUsdPerKg: 9.99 }` stored verbatim renders
 *     "down 94.8%" beside a document printing "$0.45 to $0.52, up 15.6%".
 *
 * So every row is SETTLED against the carrier's own lanes rather than merely
 * screened. This is the rule `POST /decisions` already applies to `decidedBy` and
 * the mitigate route applies to cost, extended to the one field a document
 * ingestion adds.
 *
 * WHY CARRIER-SCOPED, and why that also removes the ambiguity. A rate sheet is a
 * quote from ONE carrier, so "the rate on file" means what we pay THAT carrier on
 * that lane — a lane another carrier moves is not a rate we hold with this one.
 * Scoping there is also what makes the match unique: network-wide, `SHA-LAX` +
 * `ocean` matches both `ln-sha-lax-ocean` ($0.45) and `ln-sha-lax-ocean-exp`
 * ($0.68), and that ambiguity was the stated reason an earlier version settled
 * one direction only. Per carrier it does not arise on any seeded pair.
 *
 * `??` was considered and rejected: it repairs the under-filled case only and
 * leaves the wrong-value case stored verbatim. An overwrite cannot lose anything
 * real, because the sheet's WAS column is generated FROM `lane.costPerKg`.
 *
 * The three outcomes:
 *   - unique match  → settled from the ledger, whatever was claimed;
 *   - no match      → no rate exists, so the claim is dropped (the row then reads
 *     "new lane", which is what the ledger says);
 *   - many matches  → the app genuinely cannot say which lane the sheet meant, so
 *     the model's reading stands and the caller is TOLD, rather than the route
 *     picking one and being confidently wrong.
 *
 * Both lists ride back to the caller so the agent narrates the correction instead
 * of being silently overruled.
 */
function settlePriorRates(
  rows: RateBriefLane[],
  carrier: string,
): {
  laneRates: RateBriefLane[];
  noPriorRateOnFile: string[];
  ambiguous: string[];
} {
  const served = new Map<string, Lane[]>();
  for (const lane of store.lanesServedBy(carrier)) {
    const key = laneKey(laneCode(lane), lane.mode);
    served.set(key, [...(served.get(key) ?? []), lane]);
  }

  const noPriorRateOnFile: string[] = [];
  const ambiguous: string[] = [];
  const laneRates = rows.map((row) => {
    const matches = served.get(laneKey(row.lane, row.mode)) ?? [];
    if (matches.length === 1) {
      return { ...row, oldRateUsdPerKg: matches[0].costPerKg };
    }
    if (matches.length === 0) {
      // Only report a claim we actually removed. A row that already said
      // nothing needs no correction narrated about it.
      if (row.oldRateUsdPerKg !== undefined) noPriorRateOnFile.push(row.lane);
      return { ...row, oldRateUsdPerKg: undefined };
    }
    ambiguous.push(row.lane);
    return row;
  });
  return { laneRates, noPriorRateOnFile, ambiguous };
}

export const POST = async (req: Request) => {
  try {
    const body = await req.json().catch(() => null);
    if (body === null || typeof body !== "object") {
      return reject("BAD_REQUEST", "A JSON body is required.", 400);
    }
    const input = body as Record<string, unknown>;

    // `typeof === "string"`, not `String(...)`: `{ carrier: {} }` would
    // otherwise pass this check as the literal text "[object Object]".
    const carrier =
      typeof input.carrier === "string" ? input.carrier.trim() : "";
    const summary =
      typeof input.summary === "string" ? input.summary.trim() : "";
    if (!carrier || !summary) {
      return reject(
        "BAD_REQUEST",
        "A rate brief needs a carrier and a summary.",
        400,
      );
    }

    // decidedBy/role are NEVER read from the body — they are derived from the
    // resolved planner, exactly as `POST /decisions` does it. A client that
    // could set them would be forging the audit trail.
    const plannerId =
      typeof input.plannerId === "string" ? input.plannerId : "";
    if (!plannerId) {
      return reject("BAD_REQUEST", "plannerId is required.", 400);
    }
    const planner = store.findPlanner(plannerId);
    if (!planner) {
      return reject("BAD_REQUEST", "Unknown planner.", 400);
    }

    const claimed: RateBriefLane[] = requireList(
      input.laneRates,
      "laneRates",
      MAX_LANE_RATES,
    ).map((raw, i) => {
      const row = requireRecord(raw, `laneRates[${i}]`);
      return {
        lane: requireText(row.lane, `laneRates[${i}].lane`),
        mode: requireText(row.mode, `laneRates[${i}].mode`),
        oldRateUsdPerKg: optionalRate(
          row.oldRateUsdPerKg,
          `laneRates[${i}].oldRateUsdPerKg`,
        ),
        newRateUsdPerKg: requireRate(
          row.newRateUsdPerKg,
          `laneRates[${i}].newRateUsdPerKg`,
        ),
      };
    });
    requireDistinct(
      claimed.map((r) => `${r.lane} ${r.mode}`),
      "laneRates[].lane",
    );
    const { laneRates, noPriorRateOnFile, ambiguous } = settlePriorRates(
      claimed,
      carrier,
    );

    const impacts = requireList(input.impacts, "impacts", MAX_IMPACTS).map(
      (impact, i) => requireText(impact, `impacts[${i}]`),
    );
    requireDistinct(impacts, "impacts");

    const filed = store.fileRateBrief({
      carrier,
      // The document's own effective date, carried across. Absent is a legible
      // "the sheet did not say" rather than a date this route invented — a
      // guessed effective date is the kind of figure the agent then reads aloud.
      effective:
        typeof input.effective === "string" && input.effective.trim() !== ""
          ? input.effective.trim()
          : "not stated on the sheet",
      summary,
      laneRates,
      impacts,
      filedBy: planner.name,
      role: planner.role,
    });
    // These two ride alongside the record rather than inside it: they describe
    // what this REQUEST claimed, not what the artifact holds, and the artifact is
    // what the page renders. The tool handler reads them so the agent can narrate
    // the correction instead of being silently overruled.
    return Response.json(
      { ...filed, noPriorRateOnFile, ambiguousLanes: ambiguous },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof BriefInputError) {
      return reject(error.code, error.detail, error.status);
    }
    console.error("[logistics/api] POST briefs failed:", error);
    return Response.json(
      { error: "SERVER_ERROR", message: "Could not file the rate brief." },
      { status: 500 },
    );
  }
};
