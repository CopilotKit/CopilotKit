import { describe, it, expect } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/logistics/data/store";

describe("POST /dev/reset", () => {
  it("restores mutated state back to seed", async () => {
    store.updateShipment("shp-4821", { status: "resolved" });
    store.addDecision({
      shipmentId: "shp-4821",
      kind: "absorb",
      costUsd: 0,
      rationale: "x",
      decidedBy: "y",
      role: "Planner",
      status: "committed",
    });

    // Beat 3d's artifact is wiped too: a reset that left last run's rate brief
    // on the Decision Log would open the demo with an artifact whose document
    // was never ingested in front of this audience.
    store.fileRateBrief({
      carrier: "Pacific Star Line",
      effective: "26 August 2026",
      summary: "x",
      laneRates: [{ lane: "SHA-LAX", mode: "ocean", newRateUsdPerKg: 0.52 }],
      impacts: [],
      filedBy: "Rosa Delgado",
      role: "Planner",
    });

    const res = await POST();
    expect(res.status).toBe(200);
    expect(store.findShipment("shp-4821")?.status).toBe("delayed");
    expect(store.decisions()).toHaveLength(0);
    expect(store.rateBriefs()).toHaveLength(0);
  });
});
