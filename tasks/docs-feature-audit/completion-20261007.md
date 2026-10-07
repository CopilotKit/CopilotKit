# Completion record — October 7, 2026

Branch `tyler/docs-feature-audit` rebased onto origin/main `4d1f4c1df4` (HEAD `8383e7abe4`). All five selected React integrations pass their full strict local replay matrices on **unpatched published CopilotKit 1.77.0 with AG-UI 1.0.1**, current stable dependencies (each ≥24 h old at resolution), and their documented bring-your-own setup reproduces from a fresh copy.

| Integration          | Original audit       | Final (Oct 6, 1.77.0)                                     | Setup reproduction                      | Record                             |
| -------------------- | -------------------- | --------------------------------------------------------- | --------------------------------------- | ---------------------------------- |
| LangGraph TypeScript | 37/40 (Webpack only) | **40/40**                                                 | TS path completes a run                 | lgts-runtime-matrix-20261006.md    |
| LangGraph Python     | 38/40                | **40/40**                                                 | LangSmith + FastAPI paths complete runs | lgp-runtime-matrix-20261006.md     |
| Google ADK           | could not start      | **40/40**                                                 | completes a run                         | adk-runtime-matrix-20261006.md     |
| Strands              | 34/36                | **41/41**                                                 | completes a run                         | strands-runtime-matrix-20261006.md |
| Built-in Agent       | 35/39                | **38/38 published** (38/39 raw; unshipped thread-ID demo) | completes a run                         | bia-runtime-matrix-20261006.md     |

Docs: guard 179/179 runnable bindings (8 reviewed exclusions); full shell-docs suite 160/160 files, 1230/1230 tests (big-JSON vitest config needed on main and branch alike); production build passes; reader review of 45 pages, 5 defects fixed (reader-review-20261006.md). Before/after comparison: https://claude.ai/artifact/4k2yZEzDqz8S5vYrZ155C7 (private to the owner).

## Explicit limits

- All runtime results are AIMock replay, host-native (not Docker). No live model-provider run was made; real microphone capture/transcription and browser paperclip upload remain unproven.
- MCP Apps cells depend on the live `https://mcp.excalidraw.com/mcp` server.
- Product fix `d9a155995f` (runtime 400 for empty audio) is unreleased; published ≤1.77.0 still passes 0-byte files through.

## Open decisions for the owner

1. `validate-pins` (Showcase CI) still names 1.68.2 as canonical; it fails on main already and the selected-five bumps raise it to ~53 failures. Move the fleet pin to 1.77.0 or record exceptions.
2. Reader review R6: LangGraph HITL pages say `interrupt(...)` is supported while the manifest quarantine renders "Not supported" (same on main).
3. 056d4fc33b on main deleted several page-text tests the branch had added (quickstart identity, ADK neutral setup, MS Agent Python, Mastra agent-id, Threads prompt). Restore any you want kept.

## Follow-ups outside the selected five

Smoke-route false positive in ~16 other integrations and the scaffold; broken `npm run dev` agent path in 8 integrations; context-free inner `render_a2ui` fixtures that can mask A2UI defects; AIMock `developer`-role and reasoning-first stream shapes; upstream copilotkit-python header forwarding on tool calls; ag-ui-adk duplicate `generate_a2ui` for plain-function tools; runtime 1.77.0 `channels-*` still pulling AG-UI 0.0.59; shell-docs vitest memory with the 40 MB demo-content JSON; reader review R7/R8.
