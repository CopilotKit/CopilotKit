import { z } from "zod";
import type { SandboxFunction } from "@copilotkit/react-core/v2";
import type { InventoryRisk, Lane, Shipment } from "./data/types";
import { computeMitigationOptions } from "./data/mitigation-options";
import { deriveKpis } from "./components/kpi-strip";

/**
 * The single source the OGUI sandbox reads. Holds FULL domain objects; every
 * handler projects to a DTO at the boundary so no internal field
 * (activeEscalationId, appliedMitigation) ever crosses into the iframe's
 * LLM-authored JS. <SandboxDataSync/> keeps this in sync with the live view.
 */
export type Snapshot = {
  shipments: Shipment[];
  lanes: Lane[];
  inventory: InventoryRisk[];
};

let snapshot: Snapshot = { shipments: [], lanes: [], inventory: [] };

/**
 * Replace the snapshot the handlers read. Takes ownership of `next` by
 * reference — it does not clone. The sole caller is <SandboxDataSync/>, which
 * passes React state treated as immutable.
 */
export function setSandboxSnapshot(next: Snapshot): void {
  snapshot = next;
}

// ── Projection DTOs (allowlist — no raw domain object crosses the boundary) ──
type SafeShipment = {
  id: string;
  reference: string;
  laneId: string;
  carrier: string;
  skuId: string;
  units: number;
  weightKg: number;
  valueUsd: number;
  etaPlanned: string;
  etaCurrent: string;
  slaDate: string;
  status: Shipment["status"];
  exceptionCode: string | null;
  slaMet: boolean;
};
type SafeLane = {
  id: string;
  origin: string;
  destination: string;
  mode: Lane["mode"];
  transitDays: number;
  reliability: number;
  costPerKg: number;
  status: Lane["status"];
};
type SafeInventory = {
  skuId: string;
  name: string;
  onHandUnits: number;
  dailyDemand: number;
  daysOfCover: number;
  safetyStockDays: number;
  atRisk: boolean;
};

const toSafeShipment = (s: Shipment): SafeShipment => ({
  id: s.id,
  reference: s.reference,
  laneId: s.laneId,
  carrier: s.carrier,
  skuId: s.skuId,
  units: s.units,
  weightKg: s.weightKg,
  valueUsd: s.valueUsd,
  etaPlanned: s.etaPlanned,
  etaCurrent: s.etaCurrent,
  slaDate: s.slaDate,
  status: s.status,
  exceptionCode: s.exception?.code ?? null,
  slaMet: s.etaCurrent <= s.slaDate,
});

const toSafeLane = (l: Lane): SafeLane => ({
  id: l.id,
  origin: l.origin,
  destination: l.destination,
  mode: l.mode,
  transitDays: l.transitDays,
  reliability: l.reliability,
  costPerKg: l.costPerKg,
  status: l.status,
});

const toSafeInventory = (i: InventoryRisk): SafeInventory => ({
  skuId: i.skuId,
  name: i.name,
  onHandUnits: i.onHandUnits,
  dailyDemand: i.dailyDemand,
  daysOfCover: i.daysOfCover,
  safetyStockDays: i.safetyStockDays,
  atRisk: i.atRisk,
});

/**
 * Stable module-scope array — safe to hand straight to the provider. Handlers
 * close over the mutable module snapshot, so the array identity never changes
 * (no per-render re-registration) while the DATA stays live.
 */
export const sandboxFunctions: SandboxFunction[] = [
  {
    name: "getShipments",
    description:
      "Return the current shipments (real app data): reference, lane, carrier, units, weight, " +
      "value, planned/current ETA, promised date, status, exception code, and whether the " +
      "promised date is met. Optional `status` filters to on_track/at_risk/delayed/resolved.",
    parameters: z.object({
      status: z.enum(["on_track", "at_risk", "delayed", "resolved"]).optional(),
    }),
    handler: async ({ status }: { status?: Shipment["status"] }) =>
      (status
        ? snapshot.shipments.filter((s) => s.status === status)
        : snapshot.shipments
      ).map(toSafeShipment),
  },
  {
    name: "getLanes",
    description:
      "Return the network lanes (origin, destination, mode, transit days, on-time reliability, " +
      "cost per kg, status) — real app data.",
    parameters: z.object({}),
    handler: async () => snapshot.lanes.map(toSafeLane),
  },
  {
    name: "getInventoryRisk",
    description:
      "Return inventory positions with derived days of cover and an at-risk flag (cover below " +
      "the safety-stock floor) — real app data.",
    parameters: z.object({}),
    handler: async () => snapshot.inventory.map(toSafeInventory),
  },
  {
    name: "getKpis",
    description:
      "Return headline KPIs: onTimeRate (0..1), atRiskCount, exposureUsd, avgDelayDays — real app data.",
    parameters: z.object({}),
    handler: async () => deriveKpis(snapshot.shipments),
  },
  {
    name: "getMitigationOptions",
    description:
      "Return the available mitigation options for one shipment (kind, cost, resulting ETA, " +
      "whether the promised date is met, risk). Pass the shipment id, e.g. 'shp-4821'. " +
      "Returns an empty list for an unknown id.",
    parameters: z.object({ shipmentId: z.string() }),
    handler: async ({ shipmentId }: { shipmentId: string }) => {
      const shipment = snapshot.shipments.find(
        (s) => s.id === shipmentId || s.reference === shipmentId,
      );
      return shipment ? computeMitigationOptions(shipment, snapshot.lanes) : [];
    },
  },
];
