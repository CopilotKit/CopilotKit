/**
 * The drift guard for beat 3d's fresh row. Nothing else notices when a reseed
 * moves a carrier: the sheet still generates, the brief still files, and the one
 * row that proved the document had been read is quietly a lie or quietly gone.
 */
import { describe, expect, it } from "vitest";
import { FRESH_LANES, freshLaneFor, laneCode } from "./rate-sheet-lanes";
import * as store from "./store";

/** Every carrier the seeded network actually moves freight with. */
const seededCarriers = [...new Set(store.shipments().map((s) => s.carrier))];

/** The live lanes one carrier moves on, resolved the way the route does. */
const servedBy = (carrier: string) =>
  store
    .shipments()
    .filter((s) => s.carrier === carrier)
    .map((s) => store.findLane(s.laneId))
    .filter((lane) => lane !== undefined);

describe("laneCode", () => {
  it("prints the port codes the seed spells in parentheses", () => {
    expect(
      laneCode({ origin: "Shanghai (SHA)", destination: "Los Angeles (LAX)" }),
    ).toBe("SHA-LAX");
  });

  it("falls back to an abbreviation rather than a truncated city name", () => {
    // A fixed-width column would clip "Rotterdam" into something unrecognisable.
    expect(laneCode({ origin: "Rotterdam", destination: "New York" })).toBe(
      "ROT-NEW",
    );
  });
});

describe("freshLaneFor", () => {
  it("has an entry for every carrier on the seeded network", () => {
    // A carrier a reseed adds gets NO fresh row until an entry lands here, which
    // silently costs its sheet the one row the ledger cannot supply.
    for (const carrier of seededCarriers) {
      expect(FRESH_LANES.has(carrier), `no fresh lane for ${carrier}`).toBe(
        true,
      );
    }
  });

  it("quotes each carrier only out of an origin it actually serves", () => {
    for (const carrier of seededCarriers) {
      const fresh = freshLaneFor(carrier, servedBy(carrier), store.lanes());
      expect(fresh, `fresh lane dropped for ${carrier}`).toBeDefined();
      expect(servedBy(carrier).map((l) => l.origin)).toContain(fresh?.origin);
    }
  });

  it("never quotes a lane the network already carries", () => {
    // The whole point of the row is that it CANNOT be read off the ledger.
    const onFile = store.lanes().map((l) => `${laneCode(l)} ${l.mode}`);
    for (const carrier of seededCarriers) {
      const fresh = freshLaneFor(carrier, servedBy(carrier), store.lanes());
      expect(onFile).not.toContain(`${fresh?.lane} ${fresh?.mode}`);
    }
  });

  it("drops the row rather than misattributing it when the carrier moves off the origin", () => {
    const carrier = "Pacific Star Line";
    const elsewhere = store
      .lanes()
      .filter((l) => l.origin === "Rotterdam (RTM)");
    expect(freshLaneFor(carrier, elsewhere, store.lanes())).toBeUndefined();
  });

  it("drops the row when the network has since taken the lane on", () => {
    const carrier = "Pacific Star Line";
    const fresh = FRESH_LANES.get(carrier);
    expect(fresh).toBeDefined();
    const network = [
      ...store.lanes(),
      {
        id: "ln-sha-oak-ocean",
        origin: "Shanghai (SHA)",
        destination: `Oakland (${fresh?.lane.split("-")[1]})`,
        mode: fresh!.mode,
        transitDays: 21,
        reliability: 0.9,
        costPerKg: 0.5,
        status: "healthy" as const,
      },
    ];
    expect(freshLaneFor(carrier, servedBy(carrier), network)).toBeUndefined();
  });

  it("gives an unknown carrier no row at all", () => {
    expect(
      freshLaneFor(
        "Nobody Shipping Co",
        servedBy("Pacific Star Line"),
        store.lanes(),
      ),
    ).toBeUndefined();
  });
});
