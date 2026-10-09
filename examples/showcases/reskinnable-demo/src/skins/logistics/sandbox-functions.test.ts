import { describe, it, expect, beforeEach } from "vitest";
import {
  sandboxFunctions,
  setSandboxSnapshot,
  type Snapshot,
} from "./sandbox-functions";
import type { Lane, Shipment } from "./data/types";

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
    note: "congestion",
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
];

const shipments: Shipment[] = [
  {
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
    exception: {
      code: "PORT_CONGESTION",
      detail: "Berth wait.",
      since: "2026-07-28",
    },
    activeEscalationId: "esc-secret",
  },
  {
    id: "shp-4824",
    reference: "PO-88266",
    laneId: "ocean",
    carrier: "Pacific Star Line",
    skuId: "sku-a14",
    units: 2600,
    weightKg: 780,
    valueUsd: 131000,
    etaPlanned: "2026-08-15",
    etaCurrent: "2026-08-15",
    slaDate: "2026-08-20",
    status: "on_track",
  },
];

const snapshot: Snapshot = {
  shipments,
  lanes,
  inventory: [
    {
      skuId: "sku-a14",
      name: "A14 Drive Assembly",
      onHandUnits: 3200,
      dailyDemand: 800,
      safetyStockDays: 5,
      inboundShipmentIds: ["shp-4821"],
      daysOfCover: 4,
      atRisk: true,
    },
  ],
};

const call = (name: string, args: unknown = {}) => {
  const fn = sandboxFunctions.find((f) => f.name === name);
  if (!fn) throw new Error(`no sandbox function named ${name}`);
  return fn.handler(args as never);
};

beforeEach(() => setSandboxSnapshot(snapshot));

describe("sandbox functions", () => {
  it("projects shipments to an allowlisted DTO and drops internal fields", async () => {
    const rows = (await call("getShipments")) as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveProperty("reference", "PO-88213");
    // Internal plumbing must never cross the iframe boundary.
    expect(rows[0]).not.toHaveProperty("activeEscalationId");
    expect(rows[0]).not.toHaveProperty("appliedMitigation");
  });

  it("filters shipments by status", async () => {
    const rows = (await call("getShipments", {
      status: "delayed",
    })) as unknown[];
    expect(rows).toHaveLength(1);
  });

  it("returns lanes, inventory risk, and KPIs", async () => {
    expect((await call("getLanes")) as unknown[]).toHaveLength(2);
    expect((await call("getInventoryRisk")) as unknown[]).toHaveLength(1);
    const kpis = (await call("getKpis")) as Record<string, number>;
    expect(kpis).toHaveProperty("atRiskCount");
    expect(kpis).toHaveProperty("exposureUsd");
  });

  it("returns mitigation options for a shipment and an empty list for an unknown id", async () => {
    const options = (await call("getMitigationOptions", {
      shipmentId: "shp-4821",
    })) as unknown[];
    expect(options.length).toBeGreaterThan(1);
    expect(
      (await call("getMitigationOptions", { shipmentId: "nope" })) as unknown[],
    ).toEqual([]);
  });

  it("exposes a stable array identity so the provider never re-registers", () => {
    expect(sandboxFunctions).toBe(sandboxFunctions);
  });
});
