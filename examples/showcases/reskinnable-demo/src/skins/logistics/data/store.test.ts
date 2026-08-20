import { describe, it, expect, beforeEach } from "vitest";
import * as store from "./store";

beforeEach(() => store.reset());

describe("store", () => {
  it("seeds the headline shipment and both planners", () => {
    expect(store.findShipment("shp-4821")?.reference).toBe("PO-88213");
    expect(store.planners()).toHaveLength(2);
    expect(store.findPlanner("pl-ibrahim")?.authorityUsd).toBeNull();
  });

  it("resolves a carrier by identity rather than by spelling", () => {
    // Both beat-3d routes look a carrier up from a name a MODEL read off a PDF
    // whose masthead is `carrier.toUpperCase()`, so an exact match would call a
    // correct read a stranger — and `POST /briefs` settles every prior rate
    // against this lookup, so a miss strips them all.
    expect(store.findCarrier("  PACIFIC   star Line ")).toBe(
      "Pacific Star Line",
    );
    expect(store.findCarrier("Nobody Shipping Co")).toBeUndefined();
    expect(store.carriersOnFile()).toContain("Pacific Star Line");
  });

  it("derives the lanes a carrier serves, however its name was cased", () => {
    const exact = store.lanesServedBy("Pacific Star Line").map((l) => l.id);
    expect(exact).toEqual(["ln-sha-lax-ocean", "ln-sha-sea-ocean"]);
    expect(store.lanesServedBy("pacific star line").map((l) => l.id)).toEqual(
      exact,
    );
    expect(store.lanesServedBy("Nobody Shipping Co")).toEqual([]);
  });

  it("derives daysOfCover and flags at-risk SKUs without storing it", () => {
    const risks = store.inventoryRisk();
    const c31 = risks.find((r) => r.skuId === "sku-c31");
    expect(c31?.daysOfCover).toBe(2); // 260 / 130
    expect(c31?.atRisk).toBe(true); // 2 < safetyStockDays 4
    const d07 = risks.find((r) => r.skuId === "sku-d07");
    expect(d07?.atRisk).toBe(false);
  });

  it("openEscalation creates a draft; approveEscalation links it to the shipment", () => {
    const draft = store.openEscalation(
      "shp-4821",
      "CUSTOMER_COMMITMENT",
      "Line down risk at the LA DC.",
    );
    expect(draft.status).toBe("draft");
    expect(store.findShipment("shp-4821")?.activeEscalationId).toBeUndefined();

    const approved = store.approveEscalation(draft.id);
    expect(approved.status).toBe("approved");
    expect(store.findShipment("shp-4821")?.activeEscalationId).toBe(draft.id);
  });

  it("rejects an unknown escalation code and a double approval", () => {
    expect(() => store.openEscalation("shp-4821", "NOT_A_CODE", "x")).toThrow(
      "INVALID_ESCALATION_CODE",
    );
    expect(() =>
      store.openEscalation("nope", "CUSTOMER_COMMITMENT", "x"),
    ).toThrow("NOT_FOUND");
    const d = store.openEscalation("shp-4822", "LINE_DOWN_RISK", "x");
    store.approveEscalation(d.id);
    expect(() => store.approveEscalation(d.id)).toThrow("ALREADY_APPROVED");
  });

  it("reset restores mutations back to seed", () => {
    store.updateShipment("shp-4821", { status: "resolved" });
    store.addDecision({
      shipmentId: "shp-4821",
      kind: "absorb",
      costUsd: 0,
      rationale: "x",
      decidedBy: "Rosa Delgado",
      role: "Planner",
      status: "committed",
    });
    expect(store.decisions()).toHaveLength(1);
    store.reset();
    expect(store.findShipment("shp-4821")?.status).toBe("delayed");
    expect(store.decisions()).toHaveLength(0);
  });

  it("files decisions newest-first", () => {
    store.addDecision({
      shipmentId: "a",
      kind: "absorb",
      costUsd: 0,
      rationale: "first",
      decidedBy: "x",
      role: "Planner",
      status: "committed",
    });
    store.addDecision({
      shipmentId: "b",
      kind: "expedite",
      costUsd: 10,
      rationale: "second",
      decidedBy: "x",
      role: "Planner",
      status: "committed",
    });
    expect(store.decisions()[0].rationale).toBe("second");
  });
});

/**
 * BEAT 5 — the three writes the stored procedure fires.
 *
 * The interesting assertions here are not "the write happened": they are that
 * the actor and the carrier come from the SERVER's own record rather than from
 * the caller, that the 🚨 marker is forced rather than requested, and that a
 * reset drops all three. That last one is the demo-destroying failure — a board
 * that opens with last run's watch flag already on PO-88251 makes the stored
 * procedure look like it ran before anyone asked.
 */
describe("store — beat 5 handling writes", () => {
  it("raises a watch flag, and refuses a reason outside the closed set", () => {
    const shipment = store.raiseWatch(
      "shp-4823",
      "carrier-silent",
      "Rosa Delgado",
    );
    expect(shipment.watch).toMatchObject({
      reason: "carrier-silent",
      raisedBy: "Rosa Delgado",
    });
    expect(() => store.raiseWatch("shp-4823", "vibes", "Rosa")).toThrow(
      "INVALID_WATCH_REASON",
    );
    expect(() => store.raiseWatch("nope", "carrier-silent", "Rosa")).toThrow(
      "NOT_FOUND",
    );
  });

  it("copies the carrier off the shipment rather than trusting the caller", () => {
    const notice = store.sendCarrierNotice(
      "shp-4823",
      "recovery-plan",
      "Rosa Delgado",
    );
    // shp-4823 is carried by Norte Freight in the seed. Nothing in the call
    // above named a carrier, and that is the point: the sentence read aloud on
    // stage has to name the carrier the freight is actually with.
    expect(notice.carrier).toBe("Norte Freight");
    expect(store.findShipment("shp-4823")?.carrierNotices?.[0].id).toBe(
      notice.id,
    );
    expect(() =>
      store.sendCarrierNotice("shp-4823", "strongly-worded-letter", "Rosa"),
    ).toThrow("INVALID_CARRIER_MESSAGE");
  });

  it("forces the note marker, idempotently, and refuses an empty note", () => {
    store.addShipmentNote("shp-4823", "Carrier silent since Friday.", "Rosa");
    store.addShipmentNote("shp-4823", "🚨 Already marked.", "Rosa");
    const notes = store.findShipment("shp-4823")?.notes ?? [];
    // Newest first, like every other log in this store.
    expect(notes[0].text).toBe("🚨 Already marked.");
    expect(notes[1].text).toBe("🚨 Carrier silent since Friday.");
    expect(() => store.addShipmentNote("shp-4823", "   ", "Rosa")).toThrow(
      "EMPTY_NOTE",
    );
  });

  it("drops every handling write on reset", () => {
    store.raiseWatch("shp-4823", "carrier-silent", "Rosa");
    store.sendCarrierNotice("shp-4823", "recovery-plan", "Rosa");
    store.addShipmentNote("shp-4823", "Flagged it.", "Rosa");

    store.reset();

    const shipment = store.findShipment("shp-4823");
    expect(shipment?.watch).toBeUndefined();
    expect(shipment?.carrierNotices).toBeUndefined();
    expect(shipment?.notes).toBeUndefined();
  });
});
