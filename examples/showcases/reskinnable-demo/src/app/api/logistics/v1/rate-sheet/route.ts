import * as store from "@/skins/logistics/data/store";
import { buildRateSheetPdf } from "@/skins/logistics/data/rate-sheet-pdf";
import type { RateSheetLane } from "@/skins/logistics/data/rate-sheet-pdf";
import {
  freshLaneFor,
  laneCode,
} from "@/skins/logistics/data/rate-sheet-lanes";
import type { Lane } from "@/skins/logistics/data/types";

/**
 * BEAT 3d — serves the carrier rate sheet the demo attaches.
 *
 * Generated per request from the live network, so the lanes it quotes are the
 * lanes the Lanes page shows and the effective date is always a sensible number
 * of days out. See `rate-sheet-pdf.ts` for why this is not a static file in
 * `public/`.
 *
 * EVERY CARRIED ROW IS SCOPED TO THE CARRIER REQUESTED, and the one row that
 * cannot be (the fresh lane the beat needs) is per-carrier and origin-checked —
 * see `data/rate-sheet-lanes.ts`. The model lifts facts out of this document and
 * narrates them, so a lane the requested carrier does not serve is the app
 * asserting a service that does not exist.
 */
const DEFAULT_CARRIER = "Pacific Star Line";

/** Effective date the sheet quotes, in days from now. */
const EFFECTIVE_IN_DAYS = 14;
const DAY_MS = 86_400_000;

const LONG_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * Resolves the `carrier` lever, treating an absent value and an unusable one as
 * the same request.
 *
 * `searchParams.get("carrier") ?? DEFAULT_CARRIER` would be wrong: `??` only
 * falls back on nullish, but `?carrier=` — the shape a cleared field produces —
 * yields the EMPTY STRING, so the default would never apply, the filter would
 * match nothing and the route would 404 on a carrier nobody named. Downstream,
 * `stageAttachment` (`@/shell/attach`) maps the non-2xx to `staged === false`,
 * which ABORTS the pill — so the beat does not run at all, and the only clue to
 * why is whatever this route left in the log. Trimming makes whitespace-only
 * unusable too, and lets a stray surrounding space on a real carrier resolve.
 */
const requestedCarrier = (url: string): string =>
  new URL(url).searchParams.get("carrier")?.trim() || DEFAULT_CARRIER;

/**
 * What the carrier quotes forward on a lane it already moves.
 *
 * Derived from the lane's own health so the sheet reads like a real quote rather
 * than a random walk: a lane that is degraded or blocked is quoted UP, a
 * reliable one is quoted slightly DOWN, and everything in between HOLDS. The
 * document states no cause for any of it — `costMovementLines` computes its
 * sentences from the two rates alone, and a quoted cause would be a claim the
 * rows cannot support.
 *
 * Rounded to whole cents because that is how the sheet prints them; without the
 * rounding the document would show "$0.52" while the movement sentence divided
 * by 0.5175 and printed a percentage no reader could reproduce.
 */
const cents = (rate: number) => Math.round(rate * 100) / 100;

const quotedRate = (lane: Lane): number => {
  if (lane.status === "degraded" || lane.status === "blocked") {
    return cents(lane.costPerKg * 1.15);
  }
  if (lane.reliability >= 0.9) return cents(lane.costPerKg * 0.96);
  return lane.costPerKg;
};

/**
 * Why the WHOLE body is inside the `try`.
 *
 * This route is beat 3d's document source and the only place a failure here can
 * be diagnosed. `stageAttachment` treats any non-2xx as `staged === false` and
 * `sendMessageWithAttachment` then ABORTS the pill and alerts the presenter — so
 * the beat fails loudly rather than sending "read the attached sheet" with no
 * file attached (which would leave the model to invent the document's contents
 * and the demo to prove the exact opposite of its point). But the alert can only
 * say "HTTP 500 — see the server logs", so if this handler leaves no record the
 * presenter is stuck. Three distinct throw sites live in here: `new URL(...)`
 * before any PDF work, `buildRateSheetPdf` itself, and the `Response`
 * constructor, whose `content-disposition` interpolates the caller-supplied
 * carrier and rejects anything outside ISO-8859-1.
 */
export const GET = async (req: Request) => {
  // Hoisted out of the `try` only so the `catch` can name the carrier: it is the
  // one request-varying input, and therefore the only thing that distinguishes
  // one failing request from another in the log.
  let carrier = DEFAULT_CARRIER;
  try {
    carrier = requestedCarrier(req.url);
    // Resolved to the NETWORK's own spelling, so `?carrier=pacific star line`
    // builds the same sheet as `?carrier=Pacific%20Star%20Line` and the document
    // (and its filename, and `freshLaneFor`'s per-carrier lookup) all key off one
    // canonical name. `POST /briefs` resolves the same way, so the route that
    // BUILDS the document and the route that files the brief agree on who the
    // carrier is as well as on what it serves.
    const onFileAs = store.findCarrier(carrier);

    if (onFileAs === undefined) {
      // A carrier rename in the seed is otherwise an INVISIBLE way to disable
      // beat 3d: the pill fetches this route with no `carrier` at all, so
      // `DEFAULT_CARRIER` stops matching and the abort chain above fires with
      // only "HTTP 404" to show for it. `console.warn`, not `console.error`:
      // this is a deliberate domain answer, not a fault. The carriers on file
      // ride along because "who IS on file?" is the very next question.
      console.warn(
        `[logistics/api] GET rate-sheet?carrier=${carrier} — that carrier ` +
          `moves nothing on this network; carriers on file: ` +
          `${store.carriersOnFile().join(", ") || "(none)"}`,
      );
      return Response.json(
        {
          error: "NOT_FOUND",
          message: "That carrier moves nothing on this network.",
        },
        { status: 404 },
      );
    }
    carrier = onFileAs;
    const served = store.lanesServedBy(carrier);

    const carried: RateSheetLane[] = served.map((lane) => ({
      lane: laneCode(lane),
      mode: lane.mode,
      oldRateUsdPerKg: lane.costPerKg,
      newRateUsdPerKg: quotedRate(lane),
    }));

    // The one row the ledger cannot supply — the whole reason a filed brief can
    // be told apart from one assembled out of `store.lanes()`. Dropped rather
    // than misattributed when a reseed moves this carrier; see
    // `rate-sheet-lanes.ts`.
    const fresh = freshLaneFor(carrier, served, store.lanes());
    const lanes: RateSheetLane[] = fresh
      ? [
          ...carried,
          {
            lane: fresh.lane,
            mode: fresh.mode,
            // Left UNDEFINED rather than 0: the document must not claim a lane
            // it has never moved "rose from $0.00", and both
            // `costMovementLines` and the table read the absence as "no prior
            // rate on file".
            oldRateUsdPerKg: undefined,
            newRateUsdPerKg: fresh.newRateUsdPerKg,
            transitDays: fresh.transitDays,
          },
        ]
      : carried;

    const pdf = buildRateSheetPdf({
      carrier,
      asOf: LONG_DATE.format(new Date(Date.now() + EFFECTIVE_IN_DAYS * DAY_MS)),
      lanes,
    });

    return new Response(pdf as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="rate-sheet-${carrier
          .toLowerCase()
          .replace(/\s+/g, "-")}.pdf"`,
        // Never cache: the effective date is computed from `now`, and a cached
        // copy would quietly go stale in exactly the way a static file would.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error(
      `[logistics/api] GET rate-sheet?carrier=${carrier} failed:`,
      error,
    );
    return Response.json(
      { error: "SERVER_ERROR", message: "Could not build the rate sheet." },
      { status: 500 },
    );
  }
};
