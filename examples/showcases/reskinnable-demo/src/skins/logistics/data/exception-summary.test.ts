/**
 * BEAT 4 GUARD — a recalled preference has to CHANGE something.
 *
 * The failure this pins is not a crash. It is a summary that renders identically
 * whether or not the preference was recalled: the agent says "you like these by
 * lane" over a list grouped by carrier, and the room has no way to tell the
 * difference from the back. So every assertion below is a DIFFERENCE between the
 * two settings of one flag, never a snapshot of one setting.
 */
import { describe, expect, it } from "vitest";
import { formatExposure, summarizeExceptions } from "./exception-summary";
import seed from "./seed.json";
import type { Lane, Shipment } from "./types";

const shipments = seed.shipments as Shipment[];
const lanes = seed.lanes as Lane[];

describe("summarizeExceptions", () => {
  it("covers the exception queue and nothing else", () => {
    const groups = summarizeExceptions(shipments, lanes, {
      byLane: true,
      breachFirst: true,
    });
    const refs = groups.flatMap((g) => g.rows.map((r) => r.reference));
    const queue = shipments.filter((s) => s.exception).map((s) => s.reference);
    expect(refs.sort()).toEqual(queue.sort());
    // The clean shipments are the ones that must NOT appear: this list is the
    // queue, and the Control Tower board it has to agree with is the queue too.
    expect(refs).not.toContain("PO-88266");
  });

  it("groups by lane or by carrier, and the two really differ", () => {
    const byLane = summarizeExceptions(shipments, lanes, {
      byLane: true,
      breachFirst: false,
    }).map((g) => g.label);
    const byCarrier = summarizeExceptions(shipments, lanes, {
      byLane: false,
      breachFirst: false,
    }).map((g) => g.label);

    expect(byLane).toContain("Shanghai (SHA) → Los Angeles (LAX) (ocean)");
    expect(byCarrier).toContain("Pacific Star Line");
    expect(byLane).not.toEqual(byCarrier);
  });

  it("floats groups and rows that are past the promised date when asked", () => {
    // SHA→LAX ocean carries PO-88213 (ETA 08-12 vs promise 08-08, breached) and
    // PO-88281 (ETA 08-23 vs promise 08-26, not breached), so it is the one lane
    // where the row order can move.
    const lane = "Shanghai (SHA) → Los Angeles (LAX) (ocean)";
    const rowsFor = (breachFirst: boolean) =>
      summarizeExceptions(shipments, lanes, { byLane: true, breachFirst })
        .find((g) => g.label === lane)!
        .rows.map((r) => r.reference);

    // Without the preference the order is exposure-first: PO-88213 is $240k and
    // PO-88281 is $96k, so it leads either way — which is exactly why the group
    // ORDER below is the assertion that proves the flag did something.
    expect(rowsFor(false)).toEqual(["PO-88213", "PO-88281"]);
    expect(rowsFor(true)[0]).toBe("PO-88213");

    const withoutPref = summarizeExceptions(shipments, lanes, {
      byLane: true,
      breachFirst: false,
    }).map((g) => g.label);
    const withPref = summarizeExceptions(shipments, lanes, {
      byLane: true,
      breachFirst: true,
    }).map((g) => g.label);
    // MTY→DFW is the smallest exposure ($28k) and the only other lane already
    // past its promised date, so the preference lifts it over lanes worth more.
    const mty = "Monterrey (MTY) → Dallas (DFW) (truck)";
    expect(withoutPref.indexOf(mty)).toBeGreaterThan(withPref.indexOf(mty));
  });

  it("counts a group's exposure and its breaches", () => {
    const mty = summarizeExceptions(shipments, lanes, {
      byLane: true,
      breachFirst: true,
    }).find((g) => g.label === "Monterrey (MTY) → Dallas (DFW) (truck)");
    expect(mty?.exposureUsd).toBe(28000);
    expect(mty?.breachCount).toBe(1);
    expect(mty?.rows[0].daysLate).toBe(1); // 08-05 against a 08-04 promise
  });

  it("returns nothing at all for a network with no exceptions", () => {
    const clean = shipments.map((s) => {
      const copy = { ...s };
      delete copy.exception;
      return copy;
    });
    expect(
      summarizeExceptions(clean, lanes, { byLane: true, breachFirst: true }),
    ).toEqual([]);
  });
});

describe("formatExposure", () => {
  it("reads as whole thousands or to the dollar, unmistakably", () => {
    expect(formatExposure(240000, true)).toBe("$240k");
    expect(formatExposure(240000, false)).toBe("$240,000");
    // The rounded form is the one the preference asks for, so it must round
    // rather than truncate — $27,600 is $28k, not $27k.
    expect(formatExposure(27600, true)).toBe("$28k");
  });
});
