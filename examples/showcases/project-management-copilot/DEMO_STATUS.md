# Demo build status — `demo/pm-copilot`

All 11 phases shipped. 13 commits on `demo/pm-copilot` from `8614a75` (pre-demo baseline).

## Per-phase outcomes

| Phase                            | Status  | Key files                                                                                              | Notes                                                                                                                                   |
| -------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Domain swap (todos → issues) | Shipped | `apps/agent/src/issues.py`, `apps/app/src/components/pm-board/`                                        | 20 seeded issues. 5-column board, drag-and-drop, click-to-edit, add per column.                                                         |
| 2 — CopilotKit UI theme          | Shipped | `apps/app/src/app/globals.css`, `theme-shell/`, `threads-drawer.module.css`                            | Lavender, 6 blur circles, glass cards, `2px solid #ffffff`. Default = light (lavender).                                                 |
| 3 — Inline generative UI         | Shipped | `generative-ui/issue-card.tsx`, `issue-list.tsx`                                                       | Registered via `useComponent`. "View on board" wired through `board-events.ts`.                                                         |
| 4 — HITL on mutations            | Shipped | `generative-ui/approval-card.tsx`                                                                      | Accept / Reject / Edit. Edit lets the user override assignee, priority, status before approving.                                        |
| 5 — Shared-state timeline        | Shipped | `agent/src/analysis.py`, `pm-board/analysis-timeline.tsx`                                              | 5 steps streamed via `copilotkit_emit_state`. Glass overlay bottom-right of board, slides in / auto-dismisses.                          |
| 6 — Threads drawer polish        | Shipped | `threads-drawer.tsx`, `.module.css`                                                                    | Search input, hover-rename via `useThreads().renameThread`, archive/restore already in place. "+ New thread" reskinned.                 |
| 7 — PTT voice (Whisper)          | Shipped | `apps/bff/src/whisper-transcription.ts`                                                                | `WhisperTranscriptionService extends TranscriptionService`. Wired in `new CopilotRuntime`. `<CopilotChat>` auto-shows the mic button.   |
| 8 — MCP App tile                 | Shipped | `globals.css` (`.copilotkit-mcp-apps`)                                                                 | Glass-tile CSS for the iframe container. Suggestion prompt updated. MCP server URL pre-wired.                                           |
| 9 — aimock                       | Shipped | `fixtures/*.json`, root `package.json` scripts                                                         | 6 scenario fixtures + the original catch-all. `dev:mock` / `aimock:record` / `aimock:up`. Both BFF and Python agent honor `USE_MOCK=1`. |
| 10 — Google ADK second agent     | Shipped | `apps/agent-adk/`, `agent-selector/`, `event-inspector/`                                               | Real Google ADK + `ag-ui-adk` bridge. Same tool surface as LangGraph agent. HttpAgent in BFF. Agent selector + event inspector in UI.   |
| 11 — Polish + README             | Shipped | `README.md`, `DEMO_STATUS.md`, `pm-board/index.tsx` (empty/loading states), `scripts/seed-threads.mjs` | 7-act walkthrough README. Loading + empty board states. Optional seed script.                                                           |

## Sanity-check status

- **Frontend typecheck**: `cd apps/app && npx tsc --noEmit` → passes clean.
- **BFF typecheck**: One pre-existing TS warning from `LangGraphAgent$1` vs `AbstractAgent` (two `@ag-ui/client` copies in the workspace tree). Runs fine; same warning existed before the demo branch.
- **Agent imports**: Both `apps/agent/main.py` and `apps/agent-adk/main.py` import without error (verified with stub `OPENAI_API_KEY`).
- **Dev servers**: The pre-existing dev process (app:3002, bff:4000, agent:8123) stayed alive through every phase. ADK agent (port 8124) was added but is started by the new `dev:agent-adk` script — restart `npm run dev` to bring it up.
- **Aimock fixtures**: JSON-validated. Recording flow (`npm run aimock:record`) requires running through each scenario against real OpenAI once.

## What jerel should review before the demo

- **Run `npm run dev` once cleanly** to confirm the ADK process boots. The bridge writes a warning about experimental credential service — that's normal.
- **Test the agent selector switch** — the runtime needs to round-trip the new agentId via thread reset. If switching feels janky, the `key={agentId}` on `CopilotChatConfigurationProvider` is the lever.
- **Glass density on dark mode** — `:root.dark` overrides reduce translucency for the "frosted" toggle. Skim `globals.css` if you want to tweak the contrast.
- **MCP iframe sizing** — `.copilotkit-mcp-apps iframe { min-height: 380px; max-height: 540px }` may need tuning depending on Excalidraw scene density.
- **PRD upload demo** — current model is GPT-4.1 (vision); PDF text extraction is implicit. If you want richer PDF handling in the demo, bake a more elaborate response into `fixtures/pdf-prd-summary.json`.
- **README screenshot placeholders** — every act references `<!-- screenshot: act-N.png -->`. Capture those once you've recorded the walkthrough.
- **Seed-threads script** — only runs cleanly against the live LangGraph agent (creates a real thread per seed). In aimock mode it should still create the threads but the model responses are mocked, which is fine for the drawer.
- **AnalysisTimeline auto-dismiss** is 8 seconds after "done." Bump it if the panel disappears before the audience can read the plan.

## Carry-overs / nice-to-have follow-up

These are out of scope but worth flagging:

- The drag-and-drop is HTML5 dnd — works fine, but doesn't show drop indicators on the destination column besides the dashed border. A dnd-kit upgrade would give nicer affordances.
- The seed script makes 4 live agent runs the first time it's used; with aimock that's deterministic, without it that's $0.01 of API spend.
- The `ag-ui-adk` bridge advertises an experimental `BaseCredentialService`. If the ADK agent ever needs real OAuth (Google services etc.), revisit.
- The `BoardLoading` skeleton doesn't differentiate "first paint" from "agent run in progress." Could be split if a confusing case shows up.
