import type { Lead, Workshop } from "./types";
import { STATUSES, WORKSHOPS } from "./types";

export interface DemandRow {
  label: string;
  count: number;
}

export function groupByStatus(leads: Lead[]): Record<string, Lead[]> {
  const groups: Record<string, Lead[]> = {};
  for (const s of STATUSES) groups[s] = [];
  for (const l of leads) {
    const key = (STATUSES as readonly string[]).includes(l.status)
      ? l.status
      : "Not started";
    (groups[key] ||= []).push(l);
  }
  return groups;
}

export function workshopDemand(leads: Lead[]): DemandRow[] {
  const counts: Record<string, number> = {};
  for (const w of WORKSHOPS) counts[w] = 0;
  for (const l of leads) {
    const key = (WORKSHOPS as readonly string[]).includes(l.workshop)
      ? l.workshop
      : "Not sure yet";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return WORKSHOPS.map((w) => ({ label: w, count: counts[w] ?? 0 })).sort(
    (a, b) => b.count - a.count,
  );
}

export function toolUsage(leads: Lead[]): DemandRow[] {
  const counts: Record<string, number> = {};
  for (const l of leads) {
    for (const t of l.tools) counts[t] = (counts[t] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export function techLevelBreakdown(leads: Lead[]): DemandRow[] {
  const counts: Record<string, number> = {};
  for (const l of leads) {
    counts[l.technical_level] = (counts[l.technical_level] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export function optInRate(leads: Lead[]): {
  yes: number;
  no: number;
  pct: number;
} {
  const yes = leads.filter((l) => l.opt_in).length;
  const no = leads.length - yes;
  return {
    yes,
    no,
    pct: leads.length ? Math.round((yes / leads.length) * 100) : 0,
  };
}

export function topWorkshop(leads: Lead[]): Workshop | null {
  const ranked = workshopDemand(leads);
  if (!ranked.length || ranked[0].count === 0) return null;
  return ranked[0].label as Workshop;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ---------------------------------------------------------------------------
// Tailwind class helpers — use raw color scales (no design-token CSS vars), so
// these widgets render correctly inside ChatGPT / Claude where the host page's
// Tailwind config isn't available.
// ---------------------------------------------------------------------------

const TECH_RING_COLORS: Record<string, string> = {
  "Non-technical":
    "bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/30",
  "Some technical":
    "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30",
  Developer:
    "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30",
  "Advanced / expert":
    "bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-violet-500/30",
};

export function techLevelClass(level: string): string {
  return (
    TECH_RING_COLORS[level] ??
    "bg-neutral-500/15 text-neutral-600 dark:text-neutral-300 ring-neutral-500/30"
  );
}

const WORKSHOP_COLORS: Record<string, string> = {
  "Agentic UI (AG-UI)":
    "bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-violet-500/30",
  "MCP Apps / Tooling":
    "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30",
  "RAG & Data Chat":
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
  "Evaluations & Guardrails":
    "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30",
  "Deploying Agents (prod)":
    "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 ring-indigo-500/30",
  "Not sure yet":
    "bg-neutral-500/15 text-neutral-600 dark:text-neutral-300 ring-neutral-500/30",
};

export function workshopClass(workshop: string): string {
  return (
    WORKSHOP_COLORS[workshop] ??
    "bg-neutral-500/15 text-neutral-600 dark:text-neutral-300 ring-neutral-500/30"
  );
}

const STATUS_COLORS: Record<string, string> = {
  "Not started":
    "bg-slate-500/15 text-slate-700 dark:text-slate-300 ring-slate-500/30",
  "In progress":
    "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30",
  Done:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
};

export function statusClass(status: string): string {
  return (
    STATUS_COLORS[status] ??
    "bg-neutral-500/15 text-neutral-600 dark:text-neutral-300 ring-neutral-500/30"
  );
}

const SEGMENT_DOTS: Record<string, string> = {
  indigo: "bg-indigo-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  slate: "bg-slate-500",
};

export function segmentDotClass(color?: string): string {
  return SEGMENT_DOTS[color ?? "slate"] ?? "bg-slate-500";
}

export const WORKSHOP_BAR: Record<string, string> = {
  "Agentic UI (AG-UI)": "bg-violet-500",
  "MCP Apps / Tooling": "bg-sky-500",
  "RAG & Data Chat": "bg-emerald-500",
  "Evaluations & Guardrails": "bg-amber-500",
  "Deploying Agents (prod)": "bg-indigo-500",
  "Not sure yet": "bg-slate-400",
};

export const TOOL_BAR: Record<string, string> = {
  CopilotKit: "bg-blue-600",
  LangChain: "bg-emerald-500",
  LlamaIndex: "bg-rose-500",
  "Vercel AI SDK": "bg-neutral-900 dark:bg-neutral-100",
  OpenAI: "bg-emerald-600",
  Anthropic: "bg-amber-500",
  "Google Gemini": "bg-sky-500",
  Other: "bg-slate-400",
};

export const TECH_STROKE: Record<string, string> = {
  "Non-technical": "stroke-rose-500",
  "Some technical": "stroke-amber-500",
  Developer: "stroke-sky-500",
  "Advanced / expert": "stroke-violet-500",
};
