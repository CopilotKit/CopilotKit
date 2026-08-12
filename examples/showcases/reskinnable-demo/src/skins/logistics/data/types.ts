export type Mode = "ocean" | "air" | "rail" | "truck";

export type ExceptionCode =
  | "PORT_CONGESTION"
  | "CUSTOMS_HOLD"
  | "CARRIER_DELAY"
  | "WEATHER"
  | "CAPACITY_SHORTFALL"
  | "DOC_MISMATCH";

export type MitigationKind = "expedite" | "reroute" | "split" | "absorb";

export interface Lane {
  id: string;
  origin: string;
  destination: string;
  mode: Mode;
  transitDays: number;
  /** On-time rate, 0..1. */
  reliability: number;
  costPerKg: number;
  status: "healthy" | "degraded" | "blocked";
  note?: string;
}

export interface Shipment {
  id: string;
  reference: string;
  laneId: string;
  carrier: string;
  skuId: string;
  units: number;
  weightKg: number;
  valueUsd: number;
  /** ISO date (YYYY-MM-DD). */
  etaPlanned: string;
  etaCurrent: string;
  /** Promised-to-customer date. */
  slaDate: string;
  status: "on_track" | "at_risk" | "delayed" | "resolved";
  exception?: { code: ExceptionCode; detail: string; since: string };
  appliedMitigation?: {
    kind: MitigationKind;
    costUsd: number;
    decidedAt: string;
  };
  /** Set by approveEscalation. This is what lifts the authority gate. */
  activeEscalationId?: string;
}

export interface InventoryItem {
  skuId: string;
  name: string;
  onHandUnits: number;
  dailyDemand: number;
  safetyStockDays: number;
  inboundShipmentIds: string[];
}

export interface Planner {
  id: string;
  name: string;
  role: "Planner" | "Director";
  region: string;
  /** null = unlimited (Director). */
  authorityUsd: number | null;
}

export interface Escalation {
  id: string;
  shipmentId: string;
  code: string;
  status: "draft" | "approved";
  rationale: string;
  createdAt: string;
}

export interface Decision {
  id: string;
  shipmentId: string;
  kind: MitigationKind | "escalation";
  costUsd: number;
  rationale: string;
  decidedBy: string;
  role: string;
  status: "committed" | "escalated";
  createdAt: string;
}

/**
 * BEAT 3d — the DURABLE artifact, filed from an ingested carrier rate sheet.
 *
 * Deliberately NOT a `Decision`, though that type is already persisted and
 * already on the Decision Log page. An ingested rate sheet is not a mitigation
 * on one shipment: it has no `shipmentId`, no `kind` in that union and no single
 * `costUsd`. Forcing it in would mean a `shipmentId` that lies and a `kind` that
 * is not a mitigation kind, polluting every consumer that reads the log as
 * decisions — the KPI tiles, the readables and the audit trail alike.
 *
 * Equally NOT the canvas brief: `build-brief-ops.ts` builds a2ui operations
 * under `SURFACE_ID = "decision-brief"` for the tool `renderBrief`, and that is
 * a RENDER — it lives as long as the canvas shows it and dies with the thread.
 * This record is the opposite claim: delete the whole thread and it is still
 * here, because it belongs to the application.
 */
export interface RateBrief {
  id: string;
  /** The carrier whose sheet was ingested. */
  carrier: string;
  /** The effective date the DOCUMENT states, carried across verbatim. */
  effective: string;
  summary: string;
  /**
   * The rates as the document lists them — including any lane the network does
   * not carry, which is the row that proves the file was read. `oldRate` is
   * absent, never zero, for a lane with no rate on file.
   */
  laneRates: RateBriefLane[];
  /** At most three short consequences the planner should act on. */
  impacts: string[];
  filedBy: string;
  role: string;
  createdAt: string;
}

export interface RateBriefLane {
  lane: string;
  mode: string;
  oldRateUsdPerKg?: number;
  newRateUsdPerKg: number;
}

/** Computed on demand from lane + shipment; never persisted. */
export interface MitigationOption {
  kind: MitigationKind;
  label: string;
  costUsd: number;
  etaDate: string;
  slaMet: boolean;
  riskLevel: "low" | "medium" | "high";
  rationale: string;
}

/** Derived view of an inventory item (daysOfCover is never stored). */
export interface InventoryRisk extends InventoryItem {
  daysOfCover: number;
  atRisk: boolean;
}
