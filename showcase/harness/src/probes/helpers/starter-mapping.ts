/**
 * Starter → dashboard-column-slug mapping.
 *
 * The starter-smoke matrix (`STARTERS` in
 * `showcase/tests/e2e/starter-smoke.spec.ts`) names each starter template by
 * its own slug. The dashboard has one column per
 * `showcase/integrations/<slug>/manifest.yaml` — **21** of them today (22
 * directories minus `_shared`) — and the `starter` probe family must write
 * `starter:<dashboard-column-slug>/<level>` rows so the dashboard only ever
 * sees column slugs (mirroring how `CATALOG_TO_D5_KEY` bridges the
 * harness↔dashboard namespaces in `live-status.ts`).
 *
 * This module is the single source of truth for that remap. 12 starters are
 * mapped: 5 whose slug drifts from the column slug, and 7 that map one-to-one
 * (the slug is identical on both sides).
 *
 * A column absent from this map is NOT automatically "unsupported". The
 * remaining 9 columns split three ways, and conflating them is exactly the
 * rot this file grew:
 *
 *   - `strands-typescript`, `claude-sdk-python`, `claude-sdk-typescript` —
 *     a REAL starter exists under `examples/integrations/`; nothing probes it
 *     yet. Listed in `STARTER_COLUMNS_UNPROBED` (`live-status.ts`) and rendered
 *     as the gray `?` no-data chip, NOT 🚫.
 *   - `crewai-conversational-flows` — the smoke matrix carries a `crewai-flows`
 *     starter; whether it IS this column is OQ1 in
 *     `SPEC-starter-ladder.md` §3.5 row 16 and is UNDECIDED. Declared in
 *     `UNRESOLVED_STARTERS` (drift test) rather than silently dropped.
 *   - `ag2`, `built-in-agent`, `langroid`, `ms-agent-harness-dotnet`,
 *     `spring-ai` — genuinely have no starter; these are the only columns that
 *     may render 🚫 "Not supported by this framework".
 *
 * The prior version of this comment claimed "12 mapped + 7 unmapped = 19
 * columns" and the accompanying test only asserted `size === 12`, so three
 * real starters were reported as unsupported frameworks for as long as nobody
 * counted the directories. `starter-mapping-drift.test.ts` now derives its
 * expectations from the filesystem and the CI matrix instead.
 *
 * NOTE (forward direction): `SPEC-starter-ladder.md` replaces this hand-mirrored
 * map with a per-manifest `starter_validation:` key from which the mapping is
 * DERIVED. Nothing here should grow a new hand-maintained list.
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
 * The 5 drift entries come first (slug differs across the two surfaces);
 * the 7 direct entries follow (slug identical on both sides, listed
 * explicitly so the map is exhaustive over the 12-starter matrix and the
 * drift test can assert full coverage rather than inferring identity).
 */
export const STARTER_TO_COLUMN: Readonly<Record<string, string>> = {
  // ── 5 drift mappings (starter slug ≠ dashboard column slug) ──
  adk: "google-adk",
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
