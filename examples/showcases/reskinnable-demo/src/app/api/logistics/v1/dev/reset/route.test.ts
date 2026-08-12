/**
 * The DATA half of the presenter reset, against the REAL store.
 *
 * Its sibling `route.memory.test.ts` covers the MEMORY half and has to mock the
 * store to do it — the two cannot live in one file because `vi.mock` is hoisted
 * per module, so a file that fakes `data/store` can never also assert that the
 * real one was restored.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/logistics/data/store";

afterEach(() => vi.unstubAllEnvs());

describe("POST /dev/reset", () => {
  it("restores mutated state back to seed", async () => {
    // Unset explicitly: with Intelligence configured this route also sweeps and
    // re-seeds memory over the network, which is the sibling file's subject.
    vi.stubEnv("INTELLIGENCE_API_URL", "");
    vi.stubEnv("INTELLIGENCE_API_KEY", "");

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

    // BEAT 5's three writes. Same argument as the rate brief, and sharper: a
    // board that opens with a watch flag and a 🚨 note already on PO-88251 makes
    // the stored procedure look like it ran before anyone asked for it.
    store.raiseWatch("shp-4823", "carrier-silent", "Rosa Delgado");
    store.sendCarrierNotice("shp-4823", "recovery-plan", "Rosa Delgado");
    store.addShipmentNote(
      "shp-4823",
      "Flagged for the carrier.",
      "Rosa Delgado",
    );

    const res = await POST();
    expect(res.status).toBe(200);
    // Claims the STORE only — there is no durable memory to clear on the OSS
    // path, and saying otherwise is the lie this route's memory half exists to
    // stop telling.
    expect(await res.json()).toEqual({ ok: true, reset: ["store"] });
    expect(store.findShipment("shp-4821")?.status).toBe("delayed");
    expect(store.decisions()).toHaveLength(0);
    expect(store.rateBriefs()).toHaveLength(0);

    const stalled = store.findShipment("shp-4823");
    expect(stalled?.watch).toBeUndefined();
    expect(stalled?.carrierNotices).toBeUndefined();
    expect(stalled?.notes).toBeUndefined();
  });
});
