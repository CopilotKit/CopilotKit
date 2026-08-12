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
