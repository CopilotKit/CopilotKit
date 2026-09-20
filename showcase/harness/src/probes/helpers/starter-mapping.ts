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
 *   - `crewai-conversational-flows` — RESOLVED (2026-09-15): the smoke matrix's
 *     `crewai-flows` starter IS this column. Three independent surfaces agree
 *     and none is generated from this file:
 *       1. `showcase/integrations/crewai-conversational-flows/manifest.yaml`
 *          advertises `npx copilotkit@latest init --framework flows`.
 *       2. `showcase/shell-docs/.../docs/integrations/crewai-flows/quickstart.mdx`
 *          — a docs directory named for the STARTER — advertises the SAME
 *          `--framework flows`. The column's manifest and the starter's docs
 *          scaffold one and the same template.
 *       3. Implementation kind matches: `examples/integrations/crewai-flows`'s
 *          agent is `crewai.flow.flow.Flow`-based, while
 *          `examples/integrations/crewai-crews`' agent is a `Crew`
 *          (`src/latest_ai_development/crew.py`) and its column advertises a
 *          DIFFERENT flag, `--framework crewai-crews`.
 *     It is nevertheless NOT probed: `crewai-flows` is the one smoke-matrix
 *     starter with no root `Dockerfile`, so `showcase_build.yml`'s
 *     `build-starters` matrix omits it, no `starter-crewai-flows` image is
 *     published, and no Railway service exists for the fleet to discover. It is
 *     therefore declared in `UNPROBED_STARTER_TO_COLUMN` below and its column in
 *     `STARTER_COLUMNS_UNPROBED` (`live-status.ts`) — the gray `?` chip, never
 *     the 🚫 capability claim.
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

/**
 * Starters that EXIST and own a dashboard column, but that the starter-smoke
 * fleet does not probe — so no `starter:<column>/<level>` row will ever land.
 *
 * Kept SEPARATE from `STARTER_TO_COLUMN` on purpose: that map's value set is
 * asserted equal to the dashboard's `STARTER_COLUMNS` (the PROBED set) by
 * `starter-column-equality.test.ts`, so putting an unprobed starter there would
 * make the dashboard claim a live probe that does not exist. This map records
 * the identity WITHOUT claiming the probe, which is what lets the column render
 * the honest gray `?` ("starter exists in-repo; no live starter probe yet")
 * instead of 🚫 "Not supported by this framework".
 *
 * Only name-DRIFTED starters need an entry: a starter whose directory name
 * already equals its column slug is matched by identity in
 * `starter-mapping-drift.test.ts`.
 */
export const UNPROBED_STARTER_TO_COLUMN: Readonly<Record<string, string>> = {
  // See the `crewai-conversational-flows` bullet in the module header for the
  // three-surface evidence, and for why nothing probes it.
  "crewai-flows": "crewai-conversational-flows",
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
