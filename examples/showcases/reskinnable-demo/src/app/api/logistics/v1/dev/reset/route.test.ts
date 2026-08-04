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

    const res = await POST();
    expect(res.status).toBe(200);
    expect(store.findShipment("shp-4821")?.status).toBe("delayed");
    expect(store.decisions()).toHaveLength(0);
  });
});
