/**
 * Vantage domain types. Pure types, no logic and no React — imported by the
 * store, the derive layer, the REST routes and the client hooks alike.
 *
 * All money is USD "as reported". Constant-currency figures are DERIVED in
 * derive.ts from the seeded fx table; the facts never store two copies.
 */

export type Segment = "enterprise" | "mid-market" | "smb";
export type Region = "namer" | "emea" | "apac";
export type Channel = "direct" | "partner" | "self-serve";
export type MetricId =
  | "arr"
  | "nrr"
  | "pipeline_coverage"
  | "cac_payback"
  | "logo_churn"
  | "magic_number";
export type PeriodId = "q1-2026" | "q2-2026" | "q3-2026" | "h1-2026" | "ttm";
export type Compare = "qoq" | "yoy" | "vs-plan";
export type Grain = "monthly" | "quarterly";
export type Currency = "reported" | "constant";
export type Dimension = "segment" | "region" | "channel";

export interface Lens {
  period: PeriodId;
  compare: Compare;
  segment: Segment | "all";
  region: Region | "all";
  grain: Grain;
  currency: Currency;
}

export interface FactRow {
  month: string; // "2025-01" … "2026-09"
  segment: Segment;
  region: Region;
  channel: Channel;
  newArr: number; // USD, as reported
  expansionArr: number;
  churnedArr: number;
  startingArr: number;
  pipelineCreated: number;
  closedWon: number;
  salesSpend: number;
  grossProfit: number;
  customers: number;
  churnedCustomers: number;
}
export interface PlanRow {
  month: string;
  planArr: number;
}
export interface FxRow {
  month: string;
  region: Region;
  rate: number;
} // reported × rate = constant
export interface MetricDefinition {
  id: MetricId;
  label: string;
  unit: "usd" | "ratio" | "pct" | "months";
  definition: string;
  owner: string;
  certified: boolean;
}
export interface Deal {
  id: string;
  account: string;
  segment: Segment;
  region: Region;
  valueUsd: number;
  stage: string;
  owner: string;
  status: "slipped" | "won" | "open";
  expectedMonth: string;
  slippedFrom?: string;
}
export interface BoardTile {
  kind: "kpi" | "trend" | "breakdown" | "waterfall";
  metric: MetricId;
  label: string;
  dimension?: Dimension; // breakdown only
}
export interface Board {
  id: string;
  slug: string;
  title: string;
  summary: string;
  lens: Lens;
  tiles: BoardTile[];
  notes: string[];
  origin: "seed" | "generated";
  pinned: boolean;
  createdAt: string;
  sourceDocument?: string;
  /** The "why it looks like this" chip. Unused in phase 1; beat 4 fills it. */
  note?: string;
}
export interface Source {
  id: string;
  name: string;
  warehouse: string;
  tableCount: number;
  connectedAt: string;
}
export interface Db {
  facts: FactRow[];
  plan: PlanRow[];
  fx: FxRow[];
  metrics: MetricDefinition[];
  deals: Deal[];
  boards: Board[];
  sources: Source[];
}
