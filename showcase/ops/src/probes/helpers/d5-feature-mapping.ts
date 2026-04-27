/**
 * D5 — registry-feature-id → D5-feature-type mapping.
 *
 * The Railway `railway-services` discovery source populates each
 * service's record with a `demos: string[]` field — the demo IDs from
 * `showcase/shared/feature-registry.json` joined by integration slug.
 * The D5 (`e2e-deep`) and D6 (`e2e-parity`) drivers, however, fan out
 * over the closed `D5FeatureType` enum from `helpers/d5-registry.ts`.
 *
 * Most demo IDs do not match the D5 feature type names verbatim —
 * `tool-rendering-default-catchall`, `hitl-in-chat`, `hitl-in-app`,
 * `gen-ui-tool-based`, `headless-simple`, etc. all describe demo
 * routes whose D5 conversation script is registered against a
 * different `D5FeatureType` literal. Without an explicit mapping
 * every service's `demos[]` would silently fail the
 * `isKnownFeatureType` filter in the driver and the driver would
 * short-circuit "no D5 features declared" green.
 *
 * Source of truth for which D5 feature types each demo maps to:
 *
 *   - The D5 script files under `src/probes/scripts/d5-*.ts` declare
 *     their `featureTypes` literal — that's the closed set of D5
 *     types the registry can hold.
 *   - The registry's demo IDs that share semantics with one of those
 *     types are declared here. Many registry IDs map to the same D5
 *     type (many-to-one); a few map to multiple D5 types (one-to-many,
 *     e.g. `shared-state-read-write` covers both read and write).
 *
 * Demo IDs not in this map are silently dropped — D5 covers a closed
 * set and registry features outside it (e.g. `auth`, `voice`,
 * `multimodal`, `byoc-*`) have no D5 conversation script.
 */

import type { D5FeatureType } from "./d5-registry.js";

/**
 * Map registry feature ID (from `feature-registry.json` `features[].id`)
 * to one or more `D5FeatureType` literals.
 *
 * Entries are grouped by D5 destination to make the many-to-one shape
 * obvious at a glance:
 *   - `agentic-chat`           : 1 demo
 *   - `tool-rendering`         : 4 demos (all the tool-rendering variants)
 *   - `gen-ui-headless`        : 2 demos (headless chat surfaces)
 *   - `gen-ui-custom`          : 1 demo
 *   - `hitl-text-input`        : 4 demos (in-chat HITL variants)
 *   - `hitl-approve-deny`      : 1 demo (modal/in-app approval)
 *   - `shared-state-read|write`: 1 demo, 2 D5 types (one-to-many)
 *   - `mcp-apps`               : 1 demo
 *   - `subagents`              : 1 demo
 */
const REGISTRY_TO_D5: Readonly<Record<string, readonly D5FeatureType[]>> = {
  // agentic-chat (1:1)
  "agentic-chat": ["agentic-chat"],

  // tool-rendering — every variant exercises the per-tool render pipeline
  "tool-rendering": ["tool-rendering"],
  "tool-rendering-default-catchall": ["tool-rendering"],
  "tool-rendering-custom-catchall": ["tool-rendering"],
  "tool-rendering-reasoning-chain": ["tool-rendering"],

  // gen-ui (headless tier) — D5 script `d5-gen-ui-headless.ts` drives
  // /demos/headless-simple, but the registry also exposes a fuller
  // /demos/headless-complete demo on the same surface.
  "headless-simple": ["gen-ui-headless"],
  "headless-complete": ["gen-ui-headless"],

  // gen-ui (custom tier)
  "gen-ui-tool-based": ["gen-ui-custom"],

  // hitl (text-input / in-chat tier) — every in-chat HITL variant maps
  // to the `hitl-text-input` D5 script (which navigates to
  // /demos/hitl-in-chat via preNavigateRoute).
  "hitl-in-chat": ["hitl-text-input"],
  "hitl-in-chat-booking": ["hitl-text-input"],
  "gen-ui-interrupt": ["hitl-text-input"],
  hitl: ["hitl-text-input"],

  // hitl (approve/deny tier) — out-of-chat modal approval flow.
  "hitl-in-app": ["hitl-approve-deny"],

  // shared-state — one demo covers both read+write (the D5 script
  // claims both feature types and runs once per type via
  // preNavigateRoute split).
  "shared-state-read-write": ["shared-state-read", "shared-state-write"],

  // mcp-apps + subagents (registry has both feature IDs; D5 script
  // covers both featureTypes via one /demos/subagents conversation).
  "mcp-apps": ["mcp-apps"],
  subagents: ["subagents"],
};

/**
 * Translate a list of registry feature IDs (from a service's `demos[]`)
 * into the closed set of `D5FeatureType` literals the D5/D6 drivers
 * understand. Returns a deduplicated, stable-ordered array.
 *
 *   - Unknown / unmapped registry IDs are silently skipped (D5 covers a
 *     closed set; non-D5 demos have no script and would just be marked
 *     `skipped` downstream — better to drop them upfront).
 *   - The output preserves first-occurrence order across the input list,
 *     so two callers passing the same demo set get the same feature
 *     order in their output. Determinism matters for snapshot-style
 *     tests and dashboard tile ordering.
 */
export function demosToFeatureTypes(
  demos: readonly string[],
): D5FeatureType[] {
  const out: D5FeatureType[] = [];
  const seen = new Set<D5FeatureType>();
  for (const id of demos) {
    const mapped = REGISTRY_TO_D5[id];
    if (!mapped) continue;
    for (const ft of mapped) {
      if (!seen.has(ft)) {
        seen.add(ft);
        out.push(ft);
      }
    }
  }
  return out;
}
