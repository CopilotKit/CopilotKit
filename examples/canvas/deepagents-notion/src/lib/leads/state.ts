import type { AgentState, EnrichmentState, LeadFilter } from "./types";

export const emptyFilter: LeadFilter = {
  workshops: [],
  technical_levels: [],
  tools: [],
  opt_in: "any",
  search: "",
};

export const emptyEnrichment: EnrichmentState = {
  isActive: false,
  startedAt: null,
  completedAt: null,
  perLead: {},
};

export const initialState: AgentState = {
  leads: [],
  filter: emptyFilter,
  view: "pipeline",
  segments: [],
  highlightedLeadIds: [],
  selectedLeadId: null,
  header: {
    title: "Workshop Lead Triage",
    subtitle: "Ask the assistant: “Pull the workshop signups from Notion.”",
  },
  sync: { databaseId: "", databaseTitle: "", syncedAt: null },
  enrichment: emptyEnrichment,
};

export function isFilterEmpty(f: LeadFilter): boolean {
  return (
    f.workshops.length === 0 &&
    f.technical_levels.length === 0 &&
    f.tools.length === 0 &&
    f.opt_in === "any" &&
    f.search.trim().length === 0
  );
}

export function filterCount(f: LeadFilter): number {
  let n = 0;
  if (f.workshops.length) n += 1;
  if (f.technical_levels.length) n += 1;
  if (f.tools.length) n += 1;
  if (f.opt_in !== "any") n += 1;
  if (f.search.trim().length) n += 1;
  return n;
}
