import { describe, it, expect, beforeEach } from "vitest";
import * as store from "./store";

beforeEach(() => store.reset());

describe("store", () => {
  it("seeds the headline shipment and both planners", () => {
    expect(store.findShipment("shp-4821")?.reference).toBe("PO-88213");
    expect(store.planners()).toHaveLength(2);
    expect(store.findPlanner("pl-ibrahim")?.authorityUsd).toBeNull();
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
