import * as store from "@/skins/logistics/data/store";
import { laneCode } from "@/skins/logistics/data/rate-sheet-lanes";
import type { RateBriefLane } from "@/skins/logistics/data/types";

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
 * A lane with no rate on file stays ABSENT, and only absent.
 *
 * The fresh lane on the sheet is the row that proves the document was read, and
 * it has no prior rate. Coercing that to `0` would store the brief's most
 * load-bearing row as a fall from zero — a movement the document explicitly
 * denies.
 */
function optionalRate(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requireRate(value, field);
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
 * A lane the network does not carry HAS no rate on file: that is not a judgement
 * call, it is the absence of a row. Yet an optional `oldRateUsdPerKg` is exactly
 * the shape a model fills anyway, and it did: on the first live run of this beat
 * the agent copied the quoted $0.49 into the prior-rate slot for SHA-OAK — the
 * one lane the sheet prints as "new" — and the artifact rendered "$0.49 → $0.49,
 * flat" under a document that says there is no prior rate. The record then
 * contradicted the very document it was filed from, which is the failure this
 * whole beat exists to disprove.
 *
 * So the claim is STRIPPED rather than stored. Dropping model input is normally
 * the wrong call in this codebase (`POST /plans` in commerce refuses instead of
 * trimming), and the distinction is that this drop REMOVES an unsupported claim
 * rather than quietly reshaping one: the row then reads "new lane, no prior rate
 * on file", which is what the network says. A refusal was the alternative and
 * costs a live round trip on a lane the model is demonstrably prone to filling —
 * and the `dropped` list below is returned to the caller, so the agent can say
 * so out loud rather than being silently corrected.
 *
 * Only NO-MATCH strips. A lane the network does carry keeps whatever the model
 * read off the sheet, because a code+mode can match more than one lane here
 * (SHA-LAX runs as two separate ocean strings) and the app cannot say which of
 * them the sheet meant.
 */
function withoutUnsupportedPriorRates(rows: RateBriefLane[]): {
  laneRates: RateBriefLane[];
  dropped: string[];
} {
  const onFile = new Set(
    store.lanes().map((lane) => laneKey(laneCode(lane), lane.mode)),
  );
  const dropped: string[] = [];
  const laneRates = rows.map((row) => {
    if (
      row.oldRateUsdPerKg === undefined ||
      onFile.has(laneKey(row.lane, row.mode))
    ) {
      return row;
    }
    dropped.push(row.lane);
    return { ...row, oldRateUsdPerKg: undefined };
  });
  return { laneRates, dropped };
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
    const { laneRates, dropped } = withoutUnsupportedPriorRates(claimed);

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
    // `noPriorRateOnFile` rides alongside the record rather than inside it: it
    // describes what this REQUEST claimed, not what the artifact holds, and the
    // artifact is what the page renders. The tool handler reads it so the agent
    // can narrate the correction instead of being silently overruled.
    return Response.json(
      { ...filed, noPriorRateOnFile: dropped },
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
