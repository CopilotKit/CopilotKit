/**
 * BEAT 3d — the ONE row of a carrier rate sheet that the live network cannot
 * supply, per carrier.
 *
 * The fresh row is the beat's proof of reading: a lane Meridian has never moved
 * freight on, so an agent that files its quoted rate demonstrably read the
 * attachment rather than re-deriving everything from `store.lanes()`, which it
 * can already see in full. If every figure in the filed brief could have come
 * from the ledger, the document was never read and the beat proves the opposite
 * of its claim while looking perfect.
 *
 * WHY IT IS KEYED BY CARRIER. Commerce shipped the other shape first — ONE
 * hard-coded row pushed onto every sheet it generated — so
 * `?vendor=Ardent%20Leather` returned a leather-goods supplier quoting a knit
 * crewneck. This document is the one the model lifts facts OUT of and narrates
 * as fact, so a misattributed row is the app manufacturing a commercial
 * relationship that does not exist and then asserting it on stage.
 *
 * So each entry names a lane out of an ORIGIN that carrier genuinely serves, and
 * `freshLaneFor` re-checks two things against the LIVE store before the row is
 * emitted:
 *
 *   1. the carrier still moves freight out of that origin — otherwise the quote
 *      is not credible and the row is DROPPED rather than misattributed;
 *   2. the network does not already carry that lane — otherwise it is not fresh,
 *      the agent could have read it off the ledger, and the row proves nothing.
 *
 * A reseed that moves a carrier off an origin therefore costs that carrier its
 * fresh row (its sheet becomes its served lanes alone, which is coherent, just a
 * weaker hook), and a carrier a future reseed ADDS gets no fresh row until an
 * entry is added here — `rate-sheet-lanes.test.ts` fails until it is.
 *
 * `newRateUsdPerKg` is the QUOTE's own figure rather than a ledger fact, which is
 * why it is stated here rather than derived; keep it in the ballpark of that
 * carrier's seeded lane costs so the sheet reads like a real quote.
 *
 * Server-safe: plain TS, no React, no "use client" — it is imported by a route.
 */

import type { Lane, Mode } from "./types";

export interface FreshLane {
  /** Lane code exactly as the sheet prints it, e.g. "SHA-OAK". */
  lane: string;
  mode: Mode;
  /**
   * Must match a `Lane.origin` the carrier actually serves, verbatim, or the row
   * is dropped.
   */
  origin: string;
  /** Transit days the DOCUMENT quotes. The app has no lane to read this from. */
  transitDays: number;
  newRateUsdPerKg: number;
}

/**
 * A `Map` rather than a plain object because the key is the caller-supplied
 * `?carrier=` string: a plain-object lookup walks the prototype chain, so
 * `?carrier=constructor` would resolve TRUTHY and put a garbage row on the sheet.
 */
export const FRESH_LANES: Map<string, FreshLane> = new Map([
  [
    "Pacific Star Line",
    {
      lane: "SHA-OAK",
      mode: "ocean",
      origin: "Shanghai (SHA)",
      transitDays: 21,
      newRateUsdPerKg: 0.49,
    } satisfies FreshLane,
  ],
  [
    "Blue Meridian",
    {
      lane: "SHA-LGB",
      mode: "ocean",
      origin: "Shanghai (SHA)",
      transitDays: 22,
      newRateUsdPerKg: 0.47,
    } satisfies FreshLane,
  ],
  [
    "Northline",
    {
      lane: "RTM-SAV",
      mode: "ocean",
      origin: "Rotterdam (RTM)",
      transitDays: 16,
      newRateUsdPerKg: 0.58,
    } satisfies FreshLane,
  ],
  [
    "Norte Freight",
    {
      lane: "MTY-HOU",
      mode: "truck",
      origin: "Monterrey (MTY)",
      transitDays: 2,
      newRateUsdPerKg: 0.84,
    } satisfies FreshLane,
  ],
]);

/**
 * The lane code the sheet prints for a network lane, e.g. "SHA-LAX".
 *
 * The seed spells origins as "Shanghai (SHA)", so the airport/port code is the
 * parenthesised part. A lane spelled without one falls back to the first three
 * letters uppercased rather than printing the whole city name into a fixed-width
 * column, where it would be truncated into something unrecognisable.
 */
export const laneCode = (lane: Pick<Lane, "origin" | "destination">): string =>
  `${portCode(lane.origin)}-${portCode(lane.destination)}`;

const portCode = (place: string): string =>
  place.match(/\(([^)]+)\)/)?.[1] ?? place.slice(0, 3).toUpperCase();

/**
 * The fresh row this carrier may be quoted, or `undefined` when it cannot be
 * asserted.
 *
 * `served` is the carrier's OWN live lanes (already resolved by the caller), so
 * the origin check is against what the carrier moves right now rather than
 * against this table's promise about itself. `network` is every lane in the
 * store, because "fresh" is a claim about the whole ledger, not about one
 * carrier's slice of it.
 */
export const freshLaneFor = (
  carrier: string,
  served: readonly Lane[],
  network: readonly Lane[],
): FreshLane | undefined => {
  const fresh = FRESH_LANES.get(carrier);
  if (!fresh) return undefined;
  if (!served.some((lane) => lane.origin === fresh.origin)) return undefined;
  const alreadyOnFile = network.some(
    (lane) => laneCode(lane) === fresh.lane && lane.mode === fresh.mode,
  );
  return alreadyOnFile ? undefined : fresh;
};
