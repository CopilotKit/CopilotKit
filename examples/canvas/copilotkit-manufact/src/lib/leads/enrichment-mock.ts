/**
 * Mock fixtures for the EnrichmentStream review on /components.
 *
 * Generates a stable cast of 52 fake leads (so the cell positions are
 * consistent across re-renders) and produces several EnrichmentState
 * snapshots — one per phase of a typical run.
 *
 * Real usage: agent state populates `enrichment.perLead` over the wire
 * during a LangGraph enrichment run; these helpers are only consumed by
 * the showcase page.
 */

import type {
  EnrichmentState,
  EnrichmentStatus,
  Lead,
  LeadEnrichment,
  Tier,
} from "./types";

const MOCK_NAMES = [
  "Anna Chen",
  "Marcus Reyes",
  "Priya Iyer",
  "Sven Larsen",
  "Maya Patel",
  "Diego Torres",
  "Hana Kim",
  "Felix Bauer",
  "Yuki Tanaka",
  "Liam O'Brien",
  "Aisha Mahmoud",
  "Noah Goldberg",
  "Ines Ferreira",
  "Joon Park",
  "Ravi Subramaniam",
  "Lena Voss",
  "Tomás Silva",
  "Amélie Dubois",
  "Kai Nakamura",
  "Zara Ahmed",
  "Owen Walsh",
  "Nadia Petrov",
  "Theo Marin",
  "Sofia Russo",
  "Wesley Chen",
  "Ines Carvalho",
  "Bruno Schmidt",
  "Chiara Romano",
  "Hugo Jensen",
  "Tara Lewis",
  "Ravi Kapoor",
  "Mei Zhao",
  "Oscar Mendez",
  "Linnea Berg",
  "Arjun Nair",
  "Camila Rojas",
  "Mateo Fernandez",
  "Yara El-Sayed",
  "Dmitri Volkov",
  "Iris Bergman",
  "Sami Kone",
  "Renata Costa",
  "Bilal Hassan",
  "Astrid Holm",
  "Eitan Cohen",
  "Marisol Vargas",
  "Hiroshi Sato",
  "Pernille Dahl",
  "Cyrus Aram",
  "Fatima Diallo",
  "Mira Solberg",
  "Jonas Becker",
];

const SAMPLE_BLURBS = [
  "Founder · agentic UI tooling, ex-Stripe",
  "Eng leader at Series B fintech",
  "ML engineer, RAG eval focus",
  "Solo dev shipping Notion-AI plugin",
  "Investor, generalist B2B SaaS",
  "Designer-engineer, prototyping AI features",
  "Platform PM, internal tools at FAANG",
  "Agent infra, contributing to LangGraph",
  "DevRel, MCP ecosystem",
  "CTO at agentic workflow startup",
  "Frontend lead, Next.js + Server Actions",
  "Researcher, alignment & evals",
  "Data engineer, dbt + Snowflake",
  "Hobbyist, exploring CopilotKit",
  "PhD student, multi-agent systems",
];

const TIER_CYCLE: Tier[] = ["hot", "warm", "warm", "nurture", "nurture", "drop"];

/**
 * Stable cast of 52 mock leads. Re-importing this file always returns the
 * same array, so cells stay in fixed positions across re-renders — important
 * because the visual experience of EnrichmentStream is "cells fill in over
 * time," not "cells reshuffle."
 */
export const MOCK_LEADS_52: Pick<Lead, "id" | "name" | "role" | "company">[] =
  MOCK_NAMES.slice(0, 52).map((name, i) => ({
    id: `mock-${i.toString().padStart(2, "0")}`,
    name,
    role: ["Founder", "Engineer", "Designer", "PM", "Investor"][i % 5],
    company: ["Acme", "Globex", "Initech", "Massive Dynamic", "Soylent"][i % 5],
  }));

interface BuildOpts {
  /** When the run started, ISO. Defaults to now-30s. */
  startedAt?: string;
  /** When the run completed, ISO. Implies !isActive. */
  completedAt?: string;
  /** Force isActive. Overrides the default (active when no completedAt). */
  isActive?: boolean;
}

/**
 * Build an EnrichmentState matching a target distribution of statuses.
 *
 * Status assignment is deterministic (modulo arithmetic) so the same
 * `byStatus` shape always produces the same cell layout — a stable demo.
 *
 * Errors are placed at fixed indices (5, 23) when requested, so the visual
 * "an error happened at row 1 column 6" stays consistent.
 */
export function buildMockEnrichmentState(
  byStatus: Partial<Record<EnrichmentStatus, number>>,
  opts: BuildOpts = {},
): EnrichmentState {
  const total = MOCK_LEADS_52.length;
  const order: EnrichmentStatus[] = ["scored", "summarized", "inflight", "error", "idle"];

  // Greedy fill: assign the first N cells to each requested status in
  // order; remainder fall through to idle. This guarantees the "scored"
  // cells appear at the front of the grid (as if they completed first).
  const assignments: EnrichmentStatus[] = new Array(total).fill("idle");
  let cursor = 0;
  for (const s of order) {
    const want = byStatus[s] ?? 0;
    for (let i = 0; i < want && cursor < total; i++, cursor++) {
      assignments[cursor] = s;
    }
  }

  const perLead: Record<string, LeadEnrichment> = {};
  MOCK_LEADS_52.forEach((lead, i) => {
    const status = assignments[i];
    if (status === "idle") return; // omit; caller treats missing keys as idle
    perLead[lead.id] = buildLeadEnrichment(status, i);
  });

  const isActive =
    opts.isActive ?? (opts.completedAt === undefined && hasInflight(byStatus));

  return {
    isActive,
    startedAt: opts.startedAt ?? new Date(Date.now() - 30_000).toISOString(),
    completedAt: opts.completedAt ?? null,
    perLead,
  };
}

function hasInflight(byStatus: Partial<Record<EnrichmentStatus, number>>): boolean {
  return (byStatus.inflight ?? 0) > 0;
}

function buildLeadEnrichment(
  status: EnrichmentStatus,
  index: number,
): LeadEnrichment {
  if (status === "idle") return { status };
  if (status === "inflight") {
    return { status, startedAt: new Date(Date.now() - 1500).toISOString() };
  }
  const blurb = SAMPLE_BLURBS[index % SAMPLE_BLURBS.length];
  if (status === "summarized") {
    return {
      status,
      blurb,
      details: `${blurb}. Active in agentic tooling discussions; mid-funnel.`,
      startedAt: new Date(Date.now() - 4000).toISOString(),
    };
  }
  if (status === "scored") {
    const tier = TIER_CYCLE[index % TIER_CYCLE.length];
    const score = scoreFor(tier, index);
    return {
      status,
      blurb,
      details: `${blurb}. Strong overlap with workshop topic; recent GitHub activity in adjacent ecosystem.`,
      score,
      tier,
      traceUrl: `https://smith.langchain.com/runs/mock-${index}`,
      startedAt: new Date(Date.now() - 6000).toISOString(),
      completedAt: new Date(Date.now() - 1200).toISOString(),
    };
  }
  // error
  return {
    status: "error",
    error: "Web search timed out after 4 attempts",
    startedAt: new Date(Date.now() - 8000).toISOString(),
    completedAt: new Date(Date.now() - 2000).toISOString(),
  };
}

function scoreFor(tier: Tier, salt: number): number {
  const base = tier === "hot" ? 88 : tier === "warm" ? 72 : tier === "nurture" ? 51 : 28;
  return base + ((salt * 7) % 9) - 4;
}

// ---------------------------------------------------------------------------
// Pre-baked snapshots used by /components
// ---------------------------------------------------------------------------

/** Sheet — empty (run hasn't started; everything idle). */
export const SNAPSHOT_EMPTY = (): EnrichmentState =>
  buildMockEnrichmentState({}, { isActive: false, startedAt: undefined });

/** Sheet — early run; ~4 inflight, the rest idle. */
export const SNAPSHOT_EARLY = (): EnrichmentState =>
  buildMockEnrichmentState({ inflight: 4 });

/** Sheet — mid run; mix of all statuses. */
export const SNAPSHOT_MID = (): EnrichmentState =>
  buildMockEnrichmentState({
    scored: 22,
    summarized: 6,
    inflight: 8,
    error: 2,
  });

/** Sheet — complete; all 52 scored, no errors. */
export const SNAPSHOT_COMPLETE = (): EnrichmentState =>
  buildMockEnrichmentState(
    { scored: 52 },
    {
      isActive: false,
      startedAt: new Date(Date.now() - 28_000).toISOString(),
      completedAt: new Date().toISOString(),
    },
  );

/** Sheet — complete with errors. */
export const SNAPSHOT_COMPLETE_WITH_ERRORS = (): EnrichmentState =>
  buildMockEnrichmentState(
    { scored: 47, error: 5 },
    {
      isActive: false,
      startedAt: new Date(Date.now() - 32_000).toISOString(),
      completedAt: new Date().toISOString(),
    },
  );
