import { describe, it, expect } from "vitest";
import { checkAuthority } from "./authority";
import type { Escalation, Planner, Shipment } from "./types";

const rosa: Planner = {
  id: "pl-rosa",
  name: "Rosa Delgado",
  role: "Planner",
  region: "Trans-Pacific",
  authorityUsd: 5000,
};
const ibrahim: Planner = {
  id: "pl-ibrahim",
  name: "Ibrahim Okonjo",
  role: "Director",
  region: "Global",
  authorityUsd: null,
};

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

const esc = (over: Partial<Escalation>): Escalation => ({
  id: "esc-1",
  shipmentId: "shp-4821",
  code: "CUSTOMER_COMMITMENT",
  status: "approved",
  rationale: "x",
  createdAt: "2026-08-01T00:00:00Z",
  ...over,
});

describe("checkAuthority", () => {
  it("allows spend at or under the planner's authority", () => {
    expect(
      checkAuthority({
        costUsd: 5000,
        planner: rosa,
        shipment,
        escalations: [],
      }).allowed,
    ).toBe(true);
    expect(
      checkAuthority({ costUsd: 600, planner: rosa, shipment, escalations: [] })
        .allowed,
    ).toBe(true);
  });

  it("blocks spend above the planner's authority with a symptom-only message", () => {
    const result = checkAuthority({
      costUsd: 8400,
      planner: rosa,
      shipment,
      escalations: [],
    });
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.code).toBe("OVER_AUTHORITY");
    expect(result.message).toContain("$8,400");
    expect(result.message).toContain("$5,000");
    // Must NOT leak which codes lift the gate — the agent learns that elsewhere.
    expect(result.message).not.toContain("CUSTOMER_COMMITMENT");
    expect(result.message).not.toContain("justifying");
  });

  it("lets a Director (unlimited authority) through at any cost", () => {
    expect(
      checkAuthority({
        costUsd: 999999,
        planner: ibrahim,
        shipment,
        escalations: [],
      }).allowed,
    ).toBe(true);
  });

  it("lifts the gate for an APPROVED escalation under a JUSTIFYING code", () => {
    const withEsc = { ...shipment, activeEscalationId: "esc-1" };
    const result = checkAuthority({
      costUsd: 8400,
      planner: rosa,
      shipment: withEsc,
      escalations: [esc({})],
    });
    expect(result.allowed).toBe(true);
  });

  it("does NOT lift the gate for a DRAFT escalation", () => {
    const withEsc = { ...shipment, activeEscalationId: "esc-1" };
    const result = checkAuthority({
      costUsd: 8400,
      planner: rosa,
      shipment: withEsc,
      escalations: [esc({ status: "draft" })],
    });
    expect(result.allowed).toBe(false);
  });

  it("does NOT lift the gate for an approved NON-justifying code", () => {
    const withEsc = { ...shipment, activeEscalationId: "esc-1" };
    const result = checkAuthority({
      costUsd: 8400,
      planner: rosa,
      shipment: withEsc,
      escalations: [esc({ code: "INTERNAL_CONVENIENCE" })],
    });
    expect(result.allowed).toBe(false);
  });

  it("does NOT lift the gate when the linked escalation is missing", () => {
    const withEsc = { ...shipment, activeEscalationId: "esc-gone" };
    expect(
      checkAuthority({
        costUsd: 8400,
        planner: rosa,
        shipment: withEsc,
        escalations: [],
      }).allowed,
    ).toBe(false);
  });

  it("allows zero-cost mitigations regardless of authority", () => {
    expect(
      checkAuthority({ costUsd: 0, planner: rosa, shipment, escalations: [] })
        .allowed,
    ).toBe(true);
  });
});
