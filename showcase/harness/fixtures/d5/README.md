# D5 Multi-Turn aimock Fixtures

Nine feature-type fixtures used by the D5 (complex interact) probes in
`showcase/harness/src/probes/drivers/e2e-deep.ts` (forthcoming) against the LangGraph
Python (LGP) showcase as the reference implementation.

## What "multi-turn" means in aimock

aimock's match model is **single-shot**, not conversation-aware: each fixture has
match criteria + one response, and the first fixture to match wins on every
incoming chat-completions request. There is no "session" abstraction.

Multi-turn behavior is therefore expressed as **multiple sibling fixtures in the
same file**, each of which matches a different point in the conversation:

- Turn 1 user message (greeting / first ask) — matched via `userMessage`
  substring. Substring match is **case-sensitive** (see
  `dist/router.js` in the aimock package — `text.includes(match.userMessage)`),
  so prefer fragments that are stable across capitalization (e.g. `"favorite
color"` rather than `"What is my favorite color"`).
- Turn 2 user message — matched via a different `userMessage` substring that
  doesn't collide with turn 1.
- Mid-loop re-invocations after a tool call — matched by `toolCallId` on the
  last `role: "tool"` message. **Never** match these by `userMessage`, because
  the user message has not changed between the request that emitted the tool
  call and the request that carries the tool result back. Matching by
  `userMessage` would re-match the original tool-call fixture and create an
  infinite loop. (See `skills/write-fixtures/SKILL.md` in the aimock repo,
  "Why predicate, not userMessage?" — the JSON fixture format substitutes
  `toolCallId` for the `predicate` form used in the TS API.)
- **Order matters**: `toolCallId`-routed fixtures must appear **above** their
  corresponding `userMessage`-routed first-leg fixture in the file. aimock
  iterates top-to-bottom and uses first-match-wins; if the userMessage fixture
  appears first it will keep re-matching even after a tool result is appended
  (since the user message itself has not changed), and the toolCallId fixture
  will never fire.

`tool-rendering`, `shared-state`, `hitl-approve-deny`, `hitl-text-input`,
`hitl-steps`, `gen-ui-headless`, `gen-ui-custom`, and `mcp-subagents` all rely
on this toolCallId-routed pattern. `agentic-chat` is purely text — no tools — so it uses
three plain `userMessage` substring matches.

## Per-feature-type-against-LGP-only

These fixtures are recorded **once, against LGP**, and replayed across all 17
integrations via aimock's first-match-wins fixture pool. We accept that this
elides integration-specific quirks (e.g. one integration may emit
`getWeather` instead of `get_weather`, or chain tool calls in a different
order). When that happens, D5 will report it as a test failure for that
specific integration; we will then either (a) update the integration to bring
it in line or (b) add a per-integration override fixture.

This trade — replay a single canonical fixture rather than re-record per
integration — keeps the fleet of fixtures small (9 files, not 9×17 = 153), and
keeps drift contained: when LGP changes, we re-record once, not 17 times.

## How each fixture was constructed

These fixtures were **hand-authored** against the LGP source code as the
reference, not captured via `aimock --record`. The showcase repo does not wire
up aimock's record mode (see `showcase/aimock/README.md` § "Sync policy" —
"Fixtures are hand-maintained. There is no automated capture, no scheduled
re-recording...") so this set follows the same convention as
`showcase/aimock/feature-parity.json`: read the agent source, decide what the
expected tool calls / replies should be, write JSON.

For each feature type, the authoring inputs were:

| Feature           | LGP source files                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| agentic-chat      | `showcase/integrations/langgraph-python/src/agents/agentic_chat.py`                                                                                                |
| tool-rendering    | `src/agents/tool_rendering_agent.py` (`get_weather`) + `src/app/demos/tool-rendering/weather-card.tsx`                                                             |
| shared-state      | `src/agents/shared_state_read_write.py` (`set_notes` tool, `Preferences` shared state) + `src/app/demos/shared-state-read-write/{notes-card,preferences-card}.tsx` |
| hitl-approve-deny | `src/agents/hitl_in_app.py` + `src/app/demos/hitl-in-app/{page,approval-dialog}.tsx` (`request_user_approval` frontend tool)                                       |
| hitl-text-input   | `src/agents/hitl_in_chat_agent.py` + `src/app/demos/hitl-in-chat/{page,time-picker-card}.tsx` (`book_call` HITL tool)                                              |
| hitl-steps        | `src/agents/hitl_agent.py` + `src/app/demos/hitl/page.tsx` (`generate_task_steps` frontend tool)                                                                   |
| gen-ui-headless   | `src/app/demos/headless-simple/page.tsx` (`show_card` `useComponent`) — backend agent is `src/agents/main.py`                                                      |
| gen-ui-custom     | `src/agents/gen_ui_tool_based.py` + `src/app/demos/gen-ui-tool-based/page.tsx` (`render_bar_chart` / `render_pie_chart`)                                           |
| mcp-subagents     | `src/agents/subagents.py` + `src/app/demos/subagents/{page,delegation-log}.tsx` (`research_agent` / `writing_agent` / `critique_agent`)                            |

A note on naming: the spec calls the eighth fixture `mcp-subagents`. LGP's
canonical multi-agent demo is `/demos/subagents` (subagents-as-tools).
`/demos/mcp-apps` exists separately and points at a public Excalidraw MCP
server — that would require external network reachability at probe time, so we
chose subagents as the realistic LGP fit. If a future D5 split needs both, add
a second `mcp-apps.json` fixture and let the probe key on which demo it is
exercising.

## How to re-record (when LGP changes)

When an LGP agent changes its tool surface, prompt, or expected behavior,
re-author the affected fixture by hand following the existing pattern:

1. Read the changed agent source in `showcase/integrations/langgraph-python/src/agents/<name>.py`.
2. Read the corresponding demo page in `showcase/integrations/langgraph-python/src/app/demos/<id>/page.tsx`
   to confirm what tool names the frontend registers / renders.
3. Update the fixture file in this directory:
   - Match user-typed prompts via `userMessage` substring (unique per turn).
   - Match agent loop re-invocations after a tool call via `toolCallId` on the
     id you assigned in the prior fixture's `toolCalls[].id`.
   - Keep tool-call argument shapes aligned with the agent's tool schema.
4. Validate the fixture loads cleanly:
   ```
   pnpm --filter @copilotkit/showcase-scripts test aimock-fixtures
   ```
   Note: the existing `aimock-fixtures.test.ts` discovers fixtures from
   `showcase/aimock/`, `examples/integrations/*/fixtures/`, and
   `scripts/doc-tests/fixtures/` — it does **not** currently scan
   `showcase/harness/fixtures/d5/`. Either extend that test's globs in the same
   PR that lands the D5 driver, or run `loadFixtureFile` + `validateFixtures`
   from `@copilotkit/aimock` directly against this directory in a small
   one-off check.
5. Replay-verify each leg of the conversation against a booted aimock:
   ```
   npx @copilotkit/aimock --port 14010 --fixtures showcase/harness/fixtures/d5/<feature>.json --validate-on-load
   ```
   then issue chat-completions requests for each turn (turn 1 user message,
   turn 1 follow-up after tool result, turn 2 user message, ...) and assert
   the response shape matches what the fixture promises (text content or
   `tool_calls`). The set of 9 fixtures was bootstrapped this way at
   authoring time — 22 legs across 9 files, all replay-passing.
6. Once the D5 driver exists, run it against the LGP showcase locally with
   aimock pointed at the per-fixture file and confirm the full conversation
   short-circuits the live LLM (no requests should escape to the real
   provider).

If automated recording becomes worthwhile, the path is to wire aimock's
`--record` mode into a periodic workflow that re-captures against real
providers and diffs against checked-in fixtures — same idea sketched in
`showcase/aimock/README.md` § "Drift risk".

## Tradeoffs of the per-feature-type-against-LGP-only choice

**Pros:**

- 9 fixture files, not 153. Fewer files to keep in sync.
- LGP is the reference implementation by design — fixtures that match LGP's
  contract surface other integrations' divergences as legitimate parity
  failures rather than masking them with bespoke fixtures.
- One source of truth per feature.

**Cons:**

- Integrations whose tool names, argument shapes, or chaining behavior differ
  from LGP will fail D5 even when their behavior is locally correct.
- Authentic recorded behavior (real LLM streaming, real timing) is not
  captured — these are hand-authored. D5's parity-of-shape checks are still
  meaningful; latency-sensitive checks should rely on D6 (parity vs reference)
  with its own captured profile.

When per-integration overrides become necessary, place them at
`showcase/harness/fixtures/d5/<feature>.<integration>.json` and load
integration-specific fixtures ahead of the canonical one in the aimock
fixture pool (first-match-wins).

## Status of each fixture

| Fixture                  | Status                                              |
| ------------------------ | --------------------------------------------------- |
| `agentic-chat.json`      | real (3 turns, no tools)                            |
| `tool-rendering.json`    | real (1 turn, 1 tool call)                          |
| `shared-state.json`      | real (2 user turns + 1 tool-routed leg)             |
| `hitl-approve-deny.json` | real (1 turn, frontend HITL tool, approve path)     |
| `hitl-text-input.json`   | real (1 turn, frontend HITL tool, text/time picker) |
| `hitl-steps.json`        | real (2 legs: toolCallId match + userMessage match) |
| `gen-ui-headless.json`   | real (1 turn, `show_card` `useComponent`)           |
| `gen-ui-custom.json`     | real (1 turn, custom chart component)               |
| `mcp-subagents.json`     | real (1 turn, 3 chained sub-agent delegations)      |

None are marked `pending` — all nine are exercisable on LGP today against the
agent source as it stands.
