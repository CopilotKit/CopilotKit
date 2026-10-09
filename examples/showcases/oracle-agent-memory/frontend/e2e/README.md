# End-to-end tests (Playwright)

These tests drive the **real CopilotKit (V2) chat UI** against the **live Agent
Spec agent** (LangGraph over AG-UI) and **Oracle AI Database**, and record every
run to video.

## What's covered

| Spec                                                              | Proves                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `concierge.spec.ts` › recalls a preference in a brand-new session | A unique fact (`FlyHigh-<ts>` program → `ZEPHYR-<ts>` number) taught in one thread is recalled after clicking **+ New thread** (same browser session, fresh conversation) — durable **user-scoped** memory in the Agent Spec stack, via Oracle. Runs first so it sees the freshly-reset store. |
| `concierge.spec.ts` › finds a flight in a single turn             | A first turn drives the Agent Spec server tools (`recall_memory` + `search_flights`) end to end; the assertion checks details from the canonical flight (`$740` / `KLM` / `AMS-001`, nonstop), which only appear in the assistant's reply.                                                     |
| `concierge.spec.ts` › confirms before booking (HITL, single-run)  | `book_flight` is a frontend **ClientTool**, so the confirm card → boarding pass resolves within **one** agent run (no second turn) — the adapter bug below is never triggered. Passes.                                                                                                         |

## Determinism

`global-setup.ts` clears the demo user's memory before the suite (via
`e2e/reset-memory.py`). The concierge recalls through a **model-driven**
`recall_memory` tool and persists _every_ turn, so a retried recall would store
an "I don't have it" reply that poisons the next attempt; the cross-session test
therefore does **one** clean recall against the reset store, after settling so
the post-run memory write commits. **Heads-up:** the reset wipes `demo-user`'s
stored memories on every run.

### Known issue: multi-turn

A _second_ user turn in the same thread after a server-tool call trips an
upstream Agent Spec × AG-UI adapter bug (`tool_call_id` correlation). The
concierge sidesteps it: HITL booking runs as a **single** turn (`book_flight`
is a frontend ClientTool resolved in-run), and cross-session recall uses a
**new thread** rather than a follow-up turn — so every spec above is a first
turn. Details + repro:
[`docs/known-issues/agentspec-multiturn-toolcall-correlation.md`](../../docs/known-issues/agentspec-multiturn-toolcall-correlation.md).

## Prerequisites

From the repo root, with Oracle AI Database running and provisioned:

```bash
docker compose up -d
./db/setup-db.sh
```

The Playwright config (`../playwright.config.ts`) starts and **reuses** the rest:

- the **concierge agent** on `:8001` — a non-default port, so it won't collide
  with a manual `npm run dev` agent on `:8000`; the config points the
  frontend's `AGENT_URL` at `:8001/run` automatically, and
- the **frontend** on a dedicated test port `:3200`.

The agent's `.env` (with `OPENAI_API_KEY`) must be set up per the
[agent README](../../agent).

## Run

```bash
cd frontend
npm install                 # first time — pulls in @playwright/test
npx playwright install chromium   # first time — downloads the browser
npm run test:e2e            # run headless, record video
npm run test:e2e:headed     # watch it drive the browser
npm run test:e2e:report     # open the HTML report (video + trace)
```

## Videos

Every test records a `.webm` (gitignored) under `test-results/<test>/`. The
cross-session recall test now runs in a single browser context (teach, then
**+ New thread**, then recall), so it records one `video.webm` like the other
specs. The HTML report embeds the video and, on failure, a trace.
