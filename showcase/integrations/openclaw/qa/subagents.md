# QA: Sub-Agents (OpenClaw)

Demo source: `src/app/demos/subagents/page.tsx`
Route: `/demos/subagents` · Agent: `subagents` · Runtime: `/api/copilotkit-subagents`
Run against the real backend at `http://localhost:3119/demos/subagents`.

Status: **known gap** (Bucket-B). The frontend ships, but OpenClaw does not
back it end-to-end — see `PARITY_NOTES.md` ("Known gaps → subagents") and the
docstring in `src/app/api/copilotkit-subagents/route.ts`. Keep expectations
honest: the chat responds, but the **delegation log stays empty**.

## What the demo is meant to show

A supervisor LLM that fans work out to three specialized sub-agents exposed as
tools — `research_agent`, `writing_agent`, `critique_agent` — with every
delegation streaming into a live log. Each sub-agent call is meant to append an
entry to a shared `delegations` state slot, which the left pane renders and grows
in real time (research → write → critique).

The frontend reads this via `useAgent({ agentId: "subagents", updates:
[OnStateChanged, OnRunStatusChanged] })` and drives the `DelegationLog` from
`agent.state.delegations` + `agent.isRunning`. It also registers per-tool
renderers (`useRenderTool` for each sub-agent name) to surface in-chat activity
cards.

## Why it doesn't work on OpenClaw

The reference (langgraph-python / claude-sdk-typescript) does this with real
backend multi-agent orchestration: sub-agents-as-tools whose handlers run a
child `create_agent(...)` and push to shared state (LangGraph `Command(update=…)`
→ AG-UI `STATE_SNAPSHOT`). OpenClaw is a **single stateless gateway** with no
per-demo backend graph. The route just proxies to the gateway (pass-through,
`ExperimentalEmptyAdapter`). The gateway does not orchestrate sub-agents, and the
`delegations` state slot is never populated — there are no `stateWriterTools`
forwarded for this demo and no supervisor loop to emit `STATE_SNAPSHOT`s.

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy (the `subagents` agent name maps to the one OpenClaw endpoint).

## Manual steps

1. Open the demo. Confirm the layout renders:
   - Left pane: a **Sub-agent delegations** card, header `0 calls`, three
     always-visible indicator chips (Research / Writing / Critique, dimmed), and
     the italic placeholder "Ask the supervisor to complete a task."
   - Right pane: the chat, with the three suggestion chips ("Write a blog post",
     "Explain a topic", "Summarize a topic").
   - No console errors.
2. Click a suggestion chip (or send: **"Explain how large language models handle
   tool calling. Research, write a paragraph, then critique."**).
3. Observe what actually happens on OpenClaw: the gateway answers as a plain
   chat/reasoning turn. It does **not** reliably call the `research_agent` /
   `writing_agent` / `critique_agent` tools with structured delegation, so:
   - the delegation log stays at `0 calls` and keeps the placeholder;
   - the indicator chips stay dimmed (`data-fired="false"`);
   - no `delegation-entry` rows appear.

## Assertion bar (current reality)

- The chat responds without erroring — the pass-through proxy is healthy.
- The delegation log does **not** populate. `data-testid="delegation-count"`
  reads `0 calls`; there are no `data-testid="delegation-entry"` nodes. This is
  the expected failure for the gap, not a regression to file.
- If any sub-agent tool _does_ get called, its in-chat `SubAgentActivityCard`
  renders (the `useRenderTool` renderers work), but state-backed delegation still
  won't appear in the left pane.

## What would need to land

Gateway-side supervisor → sub-agent orchestration plus the ag-ui shared-state
capability wired for this demo (`forwardedProps.stateWriterTools` →
`STATE_SNAPSHOT` for the `delegations` slot). Until then, treat this demo as
not-supported and skip it in parity/e2e passes.

## Caveats

- `Delegation.status` is typed as only `"completed"` in the frontend
  (`delegation-log.tsx`); there is no running/failed rendering path here, unlike
  some fleet references.
- Do not report the empty log as a bug — it is the documented gap. File progress
  against the OpenClaw roadmap, not against this demo.
