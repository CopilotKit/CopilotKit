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
 * set and registry features outside it (e.g. `auth`,
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
 *   - `tool-rendering`         : 3 demos (all the tool-rendering variants)
 *   - `gen-ui-headless`        : 2 demos (headless chat surfaces)
 *   - `gen-ui-custom`          : 1 demo
 *   - `hitl-text-input`        : 2 demos (in-chat HITL variants using useHumanInTheLoop)
 *   - `hitl-steps`             : 1 demo (step-selection confirmation)
 *   - `hitl-approve-deny`      : 1 demo (modal/in-app approval)
 *   - `shared-state-read|write`: 1 demo, 2 D5 types (one-to-many)
 *   - `mcp-apps`               : 1 demo
 *   - `subagents`              : 1 demo
 */
const REGISTRY_TO_D5: Readonly<Record<string, readonly D5FeatureType[]>> = {
  // agentic-chat (1:1)
  "agentic-chat": ["agentic-chat"],

  // tool-rendering — split per renderer contract. Each variant exercises
  // a different testid surface so they need their own probe scripts:
  //   - `tool-rendering`                   : per-tool renderer (WeatherCard).
  //   - `tool-rendering-default-catchall`  : built-in default catchall renderer.
  //   - `tool-rendering-custom-catchall`   : custom wildcard (`*`) renderer.
  // `tool-rendering-reasoning-chain` is intentionally NOT mapped here:
  // the D5 tool-rendering probe sends "weather in Tokyo" and asserts a
  // WeatherCard, which is the wrong test for the reasoning-chain demo.
  // Reasoning-chain pages need their own D5 probe script; until one
  // exists the demo ID is silently skipped by `demosToFeatureTypes`.
  "tool-rendering": ["tool-rendering"],
  "tool-rendering-default-catchall": ["tool-rendering-default-catchall"],
  "tool-rendering-custom-catchall": ["tool-rendering-custom-catchall"],

  // gen-ui (headless tier) — `headless-simple` and `headless-complete`
  // each have their own D5 script and fixture. They live on different
  // routes (`/demos/headless-simple` vs `/demos/headless-complete`) and
  // exercise different rendering surfaces (show_card via useComponent
  // vs WeatherCard/StockCard/HighlightNote via useRenderTool +
  // useComponent + MCP), so the mapping is one-to-one.
  "headless-simple": ["gen-ui-headless"],
  "headless-complete": ["gen-ui-headless-complete"],

  // gen-ui (custom tier)
  "gen-ui-tool-based": ["gen-ui-custom"],

  // hitl (text-input / in-chat tier) — in-chat HITL variants that use
  // `useHumanInTheLoop` with a `book_call` tool call. The D5 script
  // navigates to /demos/hitl-in-chat via preNavigateRoute.
  //
  // NOTE: `gen-ui-interrupt` is intentionally NOT mapped here. That demo
  // uses `useInterrupt` (LangGraph interrupt events), not
  // `useHumanInTheLoop` (frontend tool calls). The hitl-text-input
  // fixture sends a `book_call` tool call which `useInterrupt` pages
  // never handle — the TimePickerCard never renders and the probe times
  // out. gen-ui-interrupt needs its own D5 script + fixture that drives
  // the interrupt flow; until that exists it is unmapped (silently
  // skipped by `demosToFeatureTypes`).
  "hitl-in-chat": ["hitl-text-input"],
  "hitl-in-chat-booking": ["hitl-text-input"],
  // `hitl` is used by ag2 / agno / built-in-agent / others as an alias of
  // hitl-in-chat. Repointed to `hitl-text-input` after `d5-hitl-steps.ts`
  // was removed in the genuine-pass Phase 0 cleanup.
  hitl: ["hitl-text-input"],

  // hitl (approve/deny tier) — out-of-chat modal approval flow.
  "hitl-in-app": ["hitl-approve-deny"],

  // shared-state — one demo covers both read+write (the D5 script
  // claims both feature types and runs once per type via
  // preNavigateRoute split).
  "shared-state-read-write": ["shared-state-read", "shared-state-write"],

  // mcp-apps + subagents — Phase-2A split: each registry feature ID
  // points at its own D5 probe (was previously a shared `d5-mcp-subagents`
  // probe that drove `/demos/subagents` for both, leaving `mcp-apps`
  // wrong-targeted). `d5-mcp-apps.ts` drives `/demos/mcp-apps` and
  // asserts the iframe shell; `d5-subagents.ts` drives `/demos/subagents`
  // and asserts the 3 subagent-card testids.
  "mcp-apps": ["mcp-apps"],
  subagents: ["subagents"],

  // ── LGP D5 coverage wave (Phase 2) ─────────────────────────────────
  // See `.claude/specs/lgp-d5-coverage.md` for the full design plan.

  // Chat-surface family: each surface gets its own D5 literal because
  // assertions are surface-specific (custom slot rendered, computed
  // theme colors, sidebar/popup root scoping).
  // Beautiful Chat owns a per-pill probe family rather than a single
  // aggregated probe — see `d5-beautiful-chat-*.ts` and
  // `_beautiful-chat-shared.ts`. Each literal runs its own browser
  // session against /demos/beautiful-chat so per-pill failure isolation
  // surfaces in PB by row name, and the multi-turn `useComponent`
  // rendering quirk on this surface is sidestepped. `isD5Green` uses
  // `every`, so the cell advances to D5 only when all seven probes are
  // green. Excalidraw + Calculator are intentionally excluded — see the
  // shared module for the rationale.
  "beautiful-chat": [
    "beautiful-chat-toggle-theme",
    "beautiful-chat-pie-chart",
    "beautiful-chat-bar-chart",
    "beautiful-chat-search-flights",
    "beautiful-chat-schedule-meeting",
  ],
  "chat-slots": ["chat-slots"],
  "chat-customization-css": ["chat-css"],
  "prebuilt-sidebar": ["prebuilt-sidebar"],
  "prebuilt-popup": ["prebuilt-popup"],

  // Platform family.
  auth: ["auth"],
  multimodal: ["multimodal"],
  "agent-config": ["agent-config"],

  // Frontend-tools family — split because async-streaming completion
  // semantics differ from sync (settle assertions are not reusable).
  "frontend-tools": ["frontend-tools"],
  "frontend-tools-async": ["frontend-tools-async"],

  // Reasoning family — single `reasoning-display` literal covers both
  // demo routes via preNavigateRoute. The `tool-rendering-reasoning-chain`
  // demo was removed in the LGP demo-pass; its mapping entry and probe
  // script were deleted in the genuine-pass Phase 0 cleanup.
  "reasoning-custom": ["reasoning-display"],
  "reasoning-default": ["reasoning-display"],

  // State family — `shared-state-read` registry feature reuses the
  // existing `shared-state-read` D5 literal (already paired with
  // `shared-state-write` on the read-write demo). Streaming and
  // readonly variants get their own literals.
  "shared-state-streaming": ["shared-state-streaming"],
  "readonly-state-agent-context": ["readonly-state-context"],
  "shared-state-read": ["shared-state-read"],

  // Generative-UI family — split per protocol shape (declarative spec,
  // A2UI fixed schema, open LLM-shape, agent-emitted UI). Open-tier is
  // split into a basic literal and an advanced literal because the
  // advanced demo embeds an iframe-rendered sandbox that the basic demo
  // does not — the advanced probe asserts iframe presence as its
  // distinguishing signal.
  "declarative-gen-ui": ["gen-ui-declarative"],
  "a2ui-fixed-schema": ["gen-ui-a2ui-fixed"],
  "open-gen-ui": ["gen-ui-open"],
  "open-gen-ui-advanced": ["gen-ui-open-advanced"],
  "gen-ui-agent": ["gen-ui-agent"],

  // Interrupt family — LangGraph interrupt-driven HITL, distinct from
  // useHumanInTheLoop hook patterns. The `interrupt-headless` demo was
  // removed in the LGP demo-pass; its mapping entry and probe script
  // were deleted in the genuine-pass Phase 0 cleanup.
  "gen-ui-interrupt": ["gen-ui-interrupt"],

  // BYOC family — single literal covers hashbrown + json-render via
  // preNavigateRoute swap (both render structured-output via a user
  // component; only the schema/component differs).
  "byoc-hashbrown": ["byoc"],
  "byoc-json-render": ["byoc"],

  // Voice family — voice input/output.
  voice: ["voice"],
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
export function demosToFeatureTypes(demos: readonly string[]): D5FeatureType[] {
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
