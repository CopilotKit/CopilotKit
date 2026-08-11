# QA: Shared State — Read + Write (OpenClaw)

Demo source: `src/app/demos/shared-state-read-write/page.tsx`
Route: `/demos/shared-state-read-write` · Agent: `shared-state-read-write`
Run against the real backend at `http://localhost:3119/demos/shared-state-read-write`.

Status: **supported**, and verified end-to-end at the gateway level (with
narration — see `PARITY_NOTES.md`).

## What it exercises

Bidirectional shared state between the UI and the agent over one state object:

- **UI → agent (preferences):** the sidebar form (name / tone / language /
  interests) writes into `state.preferences` via `agent.setState(...)`. The
  gateway renders inbound `state` into the model's prompt each turn, so edits
  visibly steer the reply (addresses you by name, matches tone/language).
- **agent → UI (notes):** the agent calls `set_notes({ notes })`, which writes
  `state.notes`. `useAgent({ updates: [OnStateChanged] })` re-renders the notes
  card whenever state changes.
- **UI write-back:** the notes card's **Clear** button routes through the same
  `agent.setState({ notes: [] })`, so the agent loses the notes next turn.

OpenClaw is a single stateless gateway with no per-demo backend, so there is no
`set_notes` backend tool and no preferences-injector middleware. Instead the
page **declares** its state-writer tools via
`<CopilotKit properties={{ stateWriterTools: [...] }}>`, which the v2 runtime
forwards verbatim into `RunAgentInput.forwardedProps.stateWriterTools`. The
ag-ui gateway fork parses that declaration (`set_notes` → `stateKey: "notes"`,
`mode: "replace"`), injects the tool into the model's `clientTools`, and when the
model calls it the gateway **applies the write server-side and emits a
`STATE_SNAPSHOT`** — no browser round-trip. It then re-runs the model so it
narrates the change in chat. The demo's Next.js route
(`/api/copilotkit-shared-state-read-write`) is pure pass-through.

> Note: the `route.ts` docstring calling this a "Bucket-B gap" is stale — the
> capability lives in the ag-ui fork and is verified. `PARITY_NOTES.md` and
> the gateway handler are authoritative.

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy (per-demo agent names all map to the one OpenClaw endpoint).

## Manual steps

1. Open the demo. Confirm the two cards render — **Your preferences**
   (`data-testid="preferences-card"`) and **Agent Scratch pad**
   (`data-testid="notes-card"`) — and the `CopilotSidebar` is open by default.
   The notes card shows its empty state (`data-testid="notes-empty"`) and the
   preferences JSON preview (`data-testid="pref-state-json"`) shows the seeded
   defaults (`tone: "casual"`, `language: "English"`, empty name/interests).

2. **UI → agent.** In the preferences card: type a name into
   `data-testid="pref-name"` (e.g. "Atai"), set **Tone** to `Formal`, **Language**
   to `Spanish`, and click the **Cooking** + **Travel** interest pills. Confirm
   the `pref-state-json` preview updates on each change.

3. Ask: **"What do you know about me?"** Expect the reply (within ~10s) to
   reference the name, a formal tone, Spanish, and the Cooking/Travel interests —
   confirming the gateway rendered the UI-set `preferences` into the prompt.

4. **agent → UI.** Click the **Remember something** suggestion (sends "Remember
   that I prefer morning meetings and that I don't eat dairy."). Expect: the notes
   list (`data-testid="notes-list"`) appears with entries mentioning "morning
   meetings" and "dairy", the empty state disappears, and the agent narrates what
   it saved in chat.

5. Send: **"Also remember I live in Berlin."** Confirm the notes list **grows**
   (prior notes preserved, new note added) — the model must pass the FULL updated
   list because `set_notes` runs in `mode: "replace"`.

6. **UI write-back.** With notes present, confirm the **Clear** button
   (`data-testid="notes-clear-button"`) is visible; click it. The list clears and
   `notes-empty` re-renders. Ask **"What do you remember about me?"** and confirm
   the agent no longer cites the cleared notes.

## Assertion bar

- Preferences edits appear in `pref-state-json` synchronously, and the agent's
  reply in step 3 actually reflects them (not a generic answer).
- Agent-authored notes land in the notes card via `STATE_SNAPSHOT` (state
  update, not a rendered tool card), and the full prior list survives the second
  "remember" request.
- Clear round-trips UI → agent state; the agent loses the notes next turn.
- The model narrates each `set_notes` write (the gateway re-runs it after
  applying the snapshot) — a coherent chat message, not a silent state change.

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` to
`http://127.0.0.1:8000/v1/ag-ui/operator` (Bearer gateway token,
`Accept: text/event-stream`) with `forwardedProps.stateWriterTools` declaring
`set_notes` (`stateKey: "notes"`) and a prompt asking it to remember something.
Confirm the SSE stream carries a `STATE_SNAPSHOT` whose `notes` array contains
the remembered item, followed by narration text and `RUN_FINISHED` — and **no**
`TOOL_CALL_*` for `set_notes` (it's applied server-side, not forwarded to the
browser).

## Caveats

- **No backend state store.** State is run-scoped on the gateway, seeded from the
  inbound `state` each request. There is no server-side persistence: reloading
  the page resets preferences to defaults and clears notes (the page re-seeds via
  `useEffect`).
- **`set_notes` is replace-mode.** Preserving prior notes depends on the model
  sending the full list; a model that sends only the delta would drop earlier
  notes. This is a prompt/model behavior, not a UI guarantee.
- Preferences steering is prompt injection at the gateway (inbound state rendered
  into the prompt), not a per-demo middleware — behavior comes from the ag-ui
  fork's state-writer capability, the same mechanism that backs shared-state-read.
