import { describe, it, expect } from "vitest";
import { computeMitigationOptions, findOption } from "./mitigation-options";
import type { Lane, Shipment } from "./types";

const lanes: Lane[] = [
  {
    id: "ocean",
    origin: "Shanghai (SHA)",
    destination: "Los Angeles (LAX)",
    mode: "ocean",
    transitDays: 24,
    reliability: 0.71,
    costPerKg: 0.45,
    status: "degraded",
  },
  {
    id: "air",
    origin: "Shanghai (SHA)",
    destination: "Los Angeles (LAX)",
    mode: "air",
    transitDays: 2,
    reliability: 0.94,
    costPerKg: 6.0,
    status: "healthy",
  },
  {
    id: "alt",
    origin: "Shanghai (SHA)",
    destination: "Los Angeles (LAX)",
    mode: "rail",
    transitDays: 18,
    reliability: 0.86,
    costPerKg: 0.7,
    status: "healthy",
  },
  {
    id: "blocked-air",
    origin: "X",
    destination: "Nowhere",
    mode: "air",
    transitDays: 1,
    reliability: 0.5,
    costPerKg: 9,
    status: "blocked",
  },
];

const shipment: Shipment = {
  id: "shp-4821",
  reference: "PO-88213",
  laneId: "ocean",
  carrier: "Pacific Star Line",
  skuId: "sku-a14",
  units: 4800,
  weightKg: 1400,
  valueUsd: 240000,
  etaPlanned: "2026-08-06",
  etaCurrent: "2026-08-12",
  slaDate: "2026-08-08",
  status: "delayed",
};

describe("computeMitigationOptions", () => {
  it("prices expedite at weight x air cost/kg — the $8,400 headline beat", () => {
    const expedite = findOption(shipment, lanes, "expedite");
    expect(expedite?.costUsd).toBe(8400); // 1400kg x $6.00
  });

  it("pulls the expedited ETA in by the transit days saved and meets the SLA", () => {
    const expedite = findOption(shipment, lanes, "expedite");
    // 24 - 2 = 22 days saved, but ETA cannot precede today's data: 2026-08-12 - 22d
    expect(expedite?.etaDate).toBe("2026-07-21");
    expect(expedite?.slaMet).toBe(true);
  });

  it("absorb is free, keeps the current ETA, and misses the SLA here", () => {
    const absorb = findOption(shipment, lanes, "absorb");
    expect(absorb?.costUsd).toBe(0);
    expect(absorb?.etaDate).toBe("2026-08-12");
    expect(absorb?.slaMet).toBe(false); // 08-12 is after the 08-08 SLA
    expect(absorb?.riskLevel).toBe("high");
  });

  it("reroute charges only the cost DELTA plus the flat re-documentation fee", () => {
    const reroute = findOption(shipment, lanes, "reroute");
    // 1400 x (0.70 - 0.45) = 350, + 250 fee
    expect(reroute?.costUsd).toBe(600);
    expect(reroute?.etaDate).toBe("2026-08-06"); // 24 - 18 = 6 days saved
  });

  it("split prices half the weight by air plus handling", () => {
    const split = findOption(shipment, lanes, "split");
    expect(split?.costUsd).toBe(4350); // 700 x 6.00 + 150
    expect(split?.riskLevel).toBe("medium");
  });

  it("never lets a cheaper alternate lane produce a negative reroute cost", () => {
    const cheapAlt: Lane[] = [
      lanes[0],
      { ...lanes[2], costPerKg: 0.1 }, // cheaper than the current ocean lane
    ];
    expect(findOption(shipment, cheapAlt, "reroute")?.costUsd).toBe(250); // fee only, never negative
  });

  it("omits options whose replacement lane does not exist", () => {
    const oceanOnly = [lanes[0]];
    const kinds = computeMitigationOptions(shipment, oceanOnly).map(
      (o) => o.kind,
    );
    expect(kinds).toEqual(["absorb"]); // no air lane, no alternate lane
  });

  it("ignores blocked lanes when picking a replacement", () => {
    const withBlockedAir: Lane[] = [
      lanes[0],
      { ...lanes[1], status: "blocked" },
    ];
    expect(findOption(shipment, withBlockedAir, "expedite")).toBeUndefined();
  });

  it("returns options cheapest-first after absorb", () => {
    const kinds = computeMitigationOptions(shipment, lanes).map((o) => o.kind);
    expect(kinds).toEqual(["absorb", "reroute", "split", "expedite"]);
  });
});
