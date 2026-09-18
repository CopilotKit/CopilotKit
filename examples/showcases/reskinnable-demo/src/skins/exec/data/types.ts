export type Department =
  | "manufacturing"
  | "distribution"
  | "field-services"
  | "corporate";
export type MetricId =
  | "revenue"
  | "growthQoQ"
  | "growthYoY"
  | "operatingMargin"
  | "ebitda"
  | "cash"
  | "runwayMonths"
  | "nps"
  | "burnRate"
  | "arAgingDays"
  | "dsoDays"
  | "opex"
  | "headcountCost"
  | "forecastAccuracy";
export type MetricUnit = "usd" | "pct" | "months" | "days" | "score";
export interface MetricDef {
  id: MetricId;
  label: string;
  unit: MetricUnit;
  audience: "ceo" | "cfo" | "both";
  /** |variance| above this fraction of plan is a breach (e.g. 0.05 = ±5%). */
  thresholdPct: number;
  /** Whether the metric has per-department series (opex, headcountCost) or company-wide only. */
  byDepartment: boolean;
}
/** One observation: period is "YYYY-MM", monthly over the trailing 24 months. */
export interface MetricPoint {
  metricId: MetricId;
  period: string;
  department: Department | "all";
  plan: number;
  actual: number;
  forecast: number;
}
export interface Initiative {
  id: string;
  name: string;
  owner: string;
  status: "red" | "yellow" | "green";
  note: string;
}
export type NarrativeCode = "VAR-TIMING" | "VAR-ONEOFF" | "VAR-FX" | "VAR-PLAN";
export interface Narrative {
  id: string;
  metricId: MetricId;
  period: string;
  code: NarrativeCode;
  body: string;
  source: "typed" | "ingested-memo";
  filedAt: string;
}
export type BlockKind =
  | "metricTile"
  | "trendLine"
  | "varianceBar"
  | "initiativeTable"
  | "exceptionList";
export interface BlockSpec {
  kind: BlockKind;
  title: string;
  metricId?: MetricId;
  department?: Department | "all";
  compare?: "plan" | "forecast";
  months?: number; // trendLine window, default 12
}
export type DashboardId = "ceo" | "cfo";
export interface DashboardBlock {
  id: string;
  spec: BlockSpec;
  addedAt: string;
}
export interface BoardPack {
  id: string;
  dashboardId: DashboardId;
  publishedAt: string;
  blockIds: string[];
  narrativeIds: string[];
}
export interface Exception {
  metricId: MetricId;
  period: string;
  department: Department | "all";
  variancePct: number;
  explained: boolean;
}

/** One dashboard's ordered set of blocks — `DashboardId` keys it in `LedgerSnapshot.dashboards`. */
export interface Dashboard {
  id: DashboardId;
  title: string;
  blocks: DashboardBlock[];
}

/**
 * The one snapshot read, keel's `KeelLedger` pattern applied to the exec skin's
 * REST-backed store: a single `GET` returns this whole shape so a page mounts
 * with one request and every readable describes the same instant.
 */
export interface LedgerSnapshot {
  metricDefs: MetricDef[];
  points: MetricPoint[];
  initiatives: Initiative[];
  narratives: Narrative[];
  dashboards: Record<DashboardId, Dashboard>;
  packs: BoardPack[];
  exceptions: Exception[];
}
