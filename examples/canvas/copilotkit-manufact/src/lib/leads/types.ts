export type TechLevel =
  | "Non-technical"
  | "Some technical"
  | "Developer"
  | "Advanced / expert";

export type Workshop =
  | "Agentic UI (AG-UI)"
  | "MCP Apps / Tooling"
  | "RAG & Data Chat"
  | "Evaluations & Guardrails"
  | "Deploying Agents (prod)"
  | "Not sure yet";

export type Source =
  | "Website"
  | "Referral"
  | "LinkedIn"
  | "X/Twitter"
  | "Event"
  | "Other";

export type LeadStatus = "Not started" | "In progress" | "Done";

export const STATUSES: readonly LeadStatus[] = [
  "Not started",
  "In progress",
  "Done",
] as const;

export const WORKSHOPS: readonly Workshop[] = [
  "Agentic UI (AG-UI)",
  "MCP Apps / Tooling",
  "RAG & Data Chat",
  "Evaluations & Guardrails",
  "Deploying Agents (prod)",
  "Not sure yet",
] as const;

export const TECH_LEVELS: readonly TechLevel[] = [
  "Non-technical",
  "Some technical",
  "Developer",
  "Advanced / expert",
] as const;

export interface Lead {
  id: string;
  url?: string;
  name: string;
  company: string;
  email: string;
  role: string;
  phone?: string;
  source?: string;
  technical_level: string;
  interested_in: string[];
  tools: string[];
  workshop: string;
  status: string;
  opt_in: boolean;
  message: string;
  submitted_at: string;
}

export interface LeadFilter {
  workshops: string[];
  technical_levels: string[];
  tools: string[];
  opt_in: "any" | "yes" | "no";
  search: string;
}

export interface Segment {
  id: string;
  name: string;
  description?: string;
  color?: SegmentColor;
  leadIds: string[];
}

export type SegmentColor =
  | "indigo"
  | "emerald"
  | "amber"
  | "rose"
  | "sky"
  | "violet"
  | "slate";

export type ViewMode = "pipeline" | "demand" | "list";

export interface SyncMeta {
  databaseId: string;
  databaseTitle: string;
  syncedAt: string | null;
}

export interface AgentState {
  leads: Lead[];
  filter: LeadFilter;
  view: ViewMode;
  segments: Segment[];
  highlightedLeadIds: string[];
  selectedLeadId: string | null;
  header: { title: string; subtitle: string };
  sync: SyncMeta;
  enrichment: EnrichmentState;
}

// ---------------------------------------------------------------------------
// Enrichment — long-running, per-lead streaming state
// ---------------------------------------------------------------------------
//
// Lives on agent state and ticks frequently (every cell update). The
// EnrichmentStream component reads `enrichment.perLead[leadId]` per cell and
// re-renders only the cells whose status changed. Top-level `isActive` /
// `startedAt` / `completedAt` drive the sheet → pill collapse.

export type EnrichmentStatus =
  | "idle"
  | "inflight"
  | "summarized"
  | "scored"
  | "error";

export type Tier = "hot" | "warm" | "nurture" | "drop";

export interface LeadEnrichment {
  status: EnrichmentStatus;
  /** ISO when this lead's enrichment node started. */
  startedAt?: string;
  /** ISO when scoring landed (status crosses to "scored" / "error"). */
  completedAt?: string;
  /** One-line headline shown under the cell once summarized. */
  blurb?: string;
  /** Longer summary shown on hover / in the expanded cell. */
  details?: string;
  /** 0-100, populated once status === "scored". */
  score?: number;
  /** Tier derived from rubric. Drives the corner dot color. */
  tier?: Tier;
  /** LangSmith run URL for the "Trace ↗" link. */
  traceUrl?: string;
  /** When status === "error". */
  error?: string;
}

export interface EnrichmentState {
  /** True from the first inflight cell until all cells are scored or errored. */
  isActive: boolean;
  startedAt: string | null;
  completedAt: string | null;
  /** Keyed by Lead.id (Notion page id). Missing key === idle. */
  perLead: Record<string, LeadEnrichment>;
}

// ---------------------------------------------------------------------------
// Charts — radar + score breakdowns shown per-lead and at portfolio scale
// ---------------------------------------------------------------------------

/**
 * Five-axis lead profile, normalized 0..1. Axes are the rubric dimensions
 * the demo cares about; if the rubric grows another axis, this type extends.
 *
 * Used by:
 *   - LeadRadar (LeadDetail pane + inline-in-chat render slot)
 *   - score breakdown bars on hot leads
 */
export interface RadarAxes {
  copilotKitFit: number;
  langChainFit: number;
  agenticUiInterest: number;
  productionReadiness: number;
  decisionMakerScore: number;
}

/** Reference outline drawn behind the lead's polygon as a dashed shape. */
export const ICP_REFERENCE: RadarAxes = {
  copilotKitFit: 0.85,
  langChainFit: 0.75,
  agenticUiInterest: 0.9,
  productionReadiness: 0.7,
  decisionMakerScore: 0.8,
};

// ---------------------------------------------------------------------------
// Outreach — drafts, tone, send queue
// ---------------------------------------------------------------------------

export type EmailTone =
  | "casual"
  | "technical"
  | "founder-to-founder"
  | "conference-followup";

export const EMAIL_TONES: readonly EmailTone[] = [
  "casual",
  "technical",
  "founder-to-founder",
  "conference-followup",
] as const;

export interface EmailDraft {
  subject: string;
  body: string;
  tone: EmailTone;
  /** Why the agent picked this tone — surfaced in the draft card. */
  rationale?: string;
  /** ISO timestamp of last regeneration. */
  draftedAt?: string;
}

export type SendChannel = "gmail" | "resend";

export interface SendQueueItem {
  leadId: string;
  channel: SendChannel;
  draft: EmailDraft;
  /** User toggled this off in the SendQueueModal — agent should NOT send. */
  excluded?: boolean;
}

// ---------------------------------------------------------------------------
// Rubric — weighted scoring with proposal/approve cycle
// ---------------------------------------------------------------------------

export interface RubricDimension {
  /** Stable id, e.g. "tool_overlap". */
  id: string;
  /** Human label, e.g. "Tool overlap". */
  label: string;
  /** Current weight, 0..100. Sums across the rubric should be ~100 but the
   *  UI doesn't enforce — the agent normalizes when scoring. */
  weight: number;
  /** Optional one-line explanation shown on hover. */
  description?: string;
}

export interface RubricProposal {
  /** Display name of the rubric (e.g. "OSS4AI workshop fit"). */
  name: string;
  description?: string;
  /** Final dimensions if the user accepts. */
  dimensions: RubricDimension[];
  /** Previous weights when this is an *update* proposal (vs. fresh). Keyed
   *  by `dimension.id`. Drives the green ▲ / amber ▼ delta indicator on
   *  RubricProposalCard. Omit for a fresh rubric. */
  previousWeights?: Record<string, number>;
  /** Why the agent is proposing this — shown small under the title. */
  reason?: string;
}

// Mirrors the Python `NotionHealth` TypedDict in
// agent/src/notion_integration.py. Returned by the agent's
// `notion_health_check` tool when the user pings the Notion DB.
export interface NotionHealth {
  user_id: string;
  db_title: string;
  row_count: number;
  expected_props: string[];
  actual_props: string[];
  missing_props: string[];
  error: string | null;
}
