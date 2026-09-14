/**
 * Starter → dashboard-column-slug mapping.
 *
 * The starter-smoke matrix (`STARTERS` in
 * `showcase/tests/e2e/starter-smoke.spec.ts`) names each starter template by
 * its own slug. The dashboard, however, has one column per
 * `showcase/integrations/<slug>/manifest.yaml` — 22 of them — and the `starter` probe
 * family must write `starter:<dashboard-column-slug>/<level>` rows so the
 * dashboard only ever sees column slugs (mirroring how `CATALOG_TO_D5_KEY`
 * bridges the harness↔dashboard namespaces in `live-status.ts`).
 *
 * This module is the single source of truth for that remap. There are 13
 * mapped starters: 6 whose slug drifts from the column slug, and 7 that map
 * one-to-one (the slug is identical on both sides). The other 9 dashboard
 * columns (ag2, built-in-agent, claude-sdk-python, claude-sdk-typescript,
 * crewai-conversational-flows, langroid, ms-agent-harness-dotnet, spring-ai,
 * strands-typescript) have NO mapped smoke starter — they are intentionally
 * absent from this map, and the UI renders them in the dashboard's existing
 * grey "not supported" ✗ state. 13 mapped + 9 unmapped = 22 columns.
 *
 * Slug-drift is guarded by `starter-mapping-drift.test.ts`, which asserts
 * every starter in the smoke matrix is mapped (or explicitly excluded) and
 * every mapped column slug exists as a real manifest directory.
 *
 * Keying note: the `starter` dimension keys per-level sub-rows as
 * `starter:<column-slug>/<level>` where level ∈ {health,agent,chat,
 * interaction}. This does NOT collide with the existing `agent`/`chat`/
 * `tools` depth dimensions: those are *separate dimensions* keyed
 * `<dim>:<slug>` (e.g. `agent:langgraph-python`), whereas the starter
 * smoke levels live UNDER the `starter` dimension as the `<level>` suffix
 * (`starter:langgraph-python/agent`). The dimension prefix differs, so the
 * key spaces are disjoint.
 */

/**
 * Starter slug (as it appears in the smoke matrix) → dashboard column slug
 * (the `showcase/integrations/<slug>` directory name).
 *
 * The 6 drift entries come first (slug differs across the two surfaces);
 * the 7 direct entries follow (slug identical on both sides, listed
 * explicitly so the map is exhaustive over the starter matrix and the
 * drift test can assert full coverage rather than inferring identity).
 */
export const STARTER_TO_COLUMN: Readonly<Record<string, string>> = {
  // ── 6 drift mappings (starter slug ≠ dashboard column slug) ──
  adk: "google-adk",
  antigravity: "google-antigravity",
  "langgraph-js": "langgraph-typescript",
  "strands-python": "strands",
  "ms-agent-framework-dotnet": "ms-agent-dotnet",
  "ms-agent-framework-python": "ms-agent-python",
  // ── 7 direct mappings (starter slug === dashboard column slug) ──
  "crewai-crews": "crewai-crews",
  "langgraph-fastapi": "langgraph-fastapi",
  "langgraph-python": "langgraph-python",
  agno: "agno",
  llamaindex: "llamaindex",
  mastra: "mastra",
  "pydantic-ai": "pydantic-ai",
};

/** The four smoke levels probed per starter, in dashboard sub-row order. */
export const STARTER_LEVELS = [
  "health",
  "agent",
  "chat",
  "interaction",
] as const;

export type StarterLevel = (typeof STARTER_LEVELS)[number];

/**
 * Resolve a starter slug to its dashboard column slug, or `undefined` if the
 * starter has no mapped column. A starter probe MUST remap via this resolver
 * before emitting `starter:<column-slug>/<level>` rows so the dashboard only
 * ever sees column slugs.
 */
export function starterToColumnSlug(starterSlug: string): string | undefined {
  return STARTER_TO_COLUMN[starterSlug];
}
