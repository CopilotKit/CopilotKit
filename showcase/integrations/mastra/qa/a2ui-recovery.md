# QA: A2UI Error Recovery — Mastra

## Prerequisites

- Demo deployed at `/demos/a2ui-recovery` on the dashboard host
- Agent backend healthy; `OPENAI_API_KEY` set (or aimock routing for replay)
- Requires `@ag-ui/mastra` ≥ 1.1.0 (exports `getA2UITools` via the
  `@ag-ui/mastra/a2ui` subpath) + the `@copilotkit` A2UI renderer (the
  `building`/`retrying`/`failed` lifecycle rendering)
- Wiring: the backend `a2uiRecoveryAgent` OWNS `generate_a2ui` via
  `getA2UITools({ model, defaultCatalogId, recovery })`, whose body runs the
  forced `render_a2ui` sub-agent + the toolkit validate→retry loop +
  `a2ui_recovery_exhausted` hard-fail envelope. The dedicated route
  (`src/app/api/copilotkit-a2ui-recovery/route.ts`) sets `a2ui.injectA2UITool =
false` so the runtime does not double-inject (mirrors the langgraph/ADK
  backend-owned siblings, not the strands auto-inject path)
- Reuses the **declarative-gen-ui** catalog (`catalogId:
"declarative-gen-ui-catalog"`) — no new components

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/a2ui-recovery`; page renders within 3s, a single
      centered `CopilotChat` pane (max-width ~896px, rounded-2xl, full-height)
- [ ] Both suggestion pills are visible: "Recover a bad render" +
      "Show an unrecoverable failure"
- [ ] No A2UI surface painted on first load

### 2. Heal path

- [ ] Click "Recover a bad render" — the agent calls `generate_a2ui`; the first
      inner render is structurally invalid, the loop retries, and a VALID surface
      paints (a Column with 2 Metric tiles: "Quarterly Revenue", "Win Rate")
- [ ] No "Couldn't generate the UI" hard-failure text, no "Catalog not found"
      banner
- [ ] The agent's one-line chat reply confirms the recovery

### 3. Exhaust path

- [ ] Click "Show an unrecoverable failure" — every inner render is invalid, the
      attempt cap is hit, and the tasteful hard-failure UI ("Couldn't generate
      the UI") appears
- [ ] NO faulty/broken surface ever paints (no `declarative-metric` tiles)
- [ ] The chat input remains usable after the hard failure

## Notes

- Assert stable end-states only; the transient "Retrying generation… (N/M)"
  label is threshold-gated + timing dependent — do not gate on it.
- aimock fixtures: `showcase/aimock/d6/mastra/a2ui-recovery.json` — HEAL uses
  `sequenceIndex` 0 (invalid) → 1 (valid); EXHAUST is invalid on every attempt.
  Pill prompts are unique per framework so the context-less inner render fixtures
  don't collide across integrations.
