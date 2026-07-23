# QA: Frontend Tools (Async) — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/frontend-tools-async` on the dashboard host
- Agent backend is healthy (`/api/copilotkit` GET returns `langgraph_status: "reachable"`); `OPENAI_API_KEY` is set; `LANGGRAPH_DEPLOYMENT_URL` points at a deployment exposing the `frontend_tools_async` graph (registered under agent name `frontend-tools-async`)
- Backend `frontend_tools_async.py` registers NO server-side tools; the frontend registers exactly ONE tool via `useFrontendTool`: **`query_notes`** (parameter: `keyword: string`)
- The async handler sleeps 500ms (simulated client-side DB latency) then filters an in-memory `NOTES_DB` of 7 hard-coded notes, returning up to 5 matches against `title`, `excerpt`, or `tags` (case-insensitive). The tool has a custom `render` that mounts `NotesCard`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/frontend-tools-async`; verify the `CopilotChat` panel renders centered (max width 4xl, rounded-2xl corners) within 3s
- [ ] Verify the input placeholder "Type a message" is visible
- [ ] Send "Hello"; verify the agent responds with plain text within 10s and does NOT invoke `query_notes`

### 2. Feature-Specific Checks

#### Suggestion Pills

- [ ] Verify all three suggestion pills are visible with verbatim titles:
  - "Find project-planning notes"
  - "Search for 'auth'"
  - "What do I have about reading?"
- [ ] Click "Find project-planning notes"; verify the prompt "Find my notes about project planning." is sent

#### `query_notes` — Async Handler Loading State

- [ ] After triggering the `query_notes` flow (via pill or typing "Find my notes about planning"), verify within 10s a `data-testid="notes-card"` element renders in the transcript
- [ ] While the handler's 500ms sleep is in flight (tool status ≠ `complete`), verify the card's header shows:
  - [ ] An uppercase "Notes DB" label
  - [ ] A heading `data-testid="notes-keyword"` reading `Matching "<keyword>"` where `<keyword>` is the agent's chosen search term (e.g. `planning`, `project planning`)
  - [ ] The subtext "Querying local notes DB..."
  - [ ] A "..." placeholder glyph (not the 📓 book emoji)

#### `query_notes` — Resolved State (Simulated DB Query)

- [ ] After the 500ms sleep resolves, verify the card's loading state ends within 2s:
  - [ ] The placeholder glyph flips from "..." to "📓"
  - [ ] The subtext shows "`N` match" or "`N` matches" (singular when N=1)
  - [ ] A `data-testid="notes-list"` `<ul>` renders (assuming N > 0)
- [ ] Verify the list contains between 1 and 5 `<li>` entries, each with `data-testid="note-<id>"` (IDs from `n1`–`n7`)
- [ ] For the prompt "Find my notes about project planning", verify the returned notes include at least `note-n1` (Q2 project planning kickoff) and `note-n5` (Project planning retrospective notes)
- [ ] Verify each note row renders title (bold), excerpt (grey small text), and tag pills (uppercase, rounded-full)

#### Round-Trip — Agent Consumes Async Handler Result

- [ ] After the card renders, verify the agent emits a follow-up assistant text message within 10s summarizing the matches
- [ ] Verify the summary references at least one note title or tag from the `notes-card` (confirms the agent awaited the async handler's resolved value, not just fired-and-forgot)
- [ ] Ask a follow-up like "Which of those is about onboarding?"; verify the agent references note `n1`'s excerpt ("new onboarding flow") — proving the previous tool result is retained in context

#### Zero-Match Branch — Notes Card Empty State

- [ ] Send "Search my notes for xyzzy-nonsense-keyword"
- [ ] Verify a `data-testid="notes-card"` renders with heading `Matching "xyzzy-nonsense-keyword"` (or close variant)
- [ ] Verify the card shows italic grey text "No notes matched." (no `notes-list` element)
- [ ] Verify the agent's follow-up text says no matches were found and offers to try a different keyword

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op (no notes-card, no user bubble)
- [ ] Send a ~500-character unrelated prompt; verify the agent responds without calling `query_notes`
- [ ] Trigger two `query_notes` invocations in quick succession (e.g. "Find auth notes" then immediately "Find reading notes"); verify both resolve independently and render two separate `notes-card` instances in the transcript
- [ ] Open DevTools → Console; verify no uncaught errors, no Zod parse failures, no unresolved-Promise warnings

## Expected Results

- Chat loads within 3 seconds; `notes-card` loading state appears within 10 seconds of prompt
- Async handler's 500ms sleep is observable — the loading state ("Querying local notes DB...") is visible before resolution
- After resolution, the `notes-list` renders with the correct subset of `NOTES_DB` matching the keyword
- Agent's follow-up reply demonstrably uses the resolved notes array (round-trip verified)
- Zero-match prompts render the empty-state branch, not a broken card
- No uncaught console errors; handler Promise always resolves; no layout breaks
