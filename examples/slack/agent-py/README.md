# agent-py — LangGraph interrupt probe

A deliberately tiny LangGraph agent that exists to exercise **channels' legacy
interrupt-based HITL path** end to end. It is a probe, not a demo: `create_thing`
writes nothing.

## Why this exists

Channels has two HITL models, and they are not variations on a theme — they
suspend in different places:

|                            | `thread.awaitChoice()`                 | `onInterrupt` + `thread.resume()` (this one)  |
| -------------------------- | -------------------------------------- | --------------------------------------------- |
| What blocks                | a channel-side tool handler            | the **agent's graph**, in its checkpointer    |
| The agent run              | stays open                             | **ends**; the click starts a new run          |
| Waiter storage             | in-memory `Map` in `create-channel.ts` | the agent's checkpointer + a persisted action |
| Survives a channel restart | no                                     | yes, if the component is registered           |
| Needs                      | any agent                              | a graph that calls `interrupt()`              |

Nothing in this repo exercised the second one. The north-star
`examples/integrations/langgraph-python` has zero `interrupt()` calls, and
`examples/slack/e2e/restart-recovery.ts` — the harness written for exactly this
path — no longer compiles. Hence this.

## The loop

```
route-b.ts ──AG-UI──▶ serve.py ──▶ graph ──▶ create_thing calls interrupt()
                                                        │
       graph SUSPENDS in the checkpointer  ◀─────────────┘
                                                        │
   ag_ui_langgraph emits CUSTOM event name="on_interrupt"
                                                        ▼
   Slack adapter matches it (interruptEventNames defaults to {"on_interrupt"})
                                                        ▼
   channel's onInterrupt handler posts the ConfirmThing picker; run loop ENDS
                    ...user clicks, minutes later...
                                                        ▼
   Button onClick → thread.resume({approved}) → new run with
   forwardedProps.command.resume → Command(resume=…) → graph continues
```

Two details worth knowing, because both fail silently:

- **The event name is load-bearing.** `on_interrupt` is not a label you choose;
  rename it on either side and the graph stays suspended forever with nothing
  posted to the channel.
- **The payload arrives as a JSON _string_.** `ag_ui_langgraph` sends
  `value=dump_json_safe(interrupt.value)`. All four real adapters JSON-parse it
  before your handler runs; `FakeAdapter` does **not**. Handlers that assume an
  object work in Slack and break in a headless harness.

## Setup

```sh
uv sync
```

`OPENAI_API_KEY` is read from this directory or from `examples/slack/.env`.
Optional: `AGENT_MODEL` (default `gpt-5.5`), `AGENT_PORT` (default `8210`).

## Run

```sh
uv run serve.py          # AG-UI endpoint on http://127.0.0.1:8210/agent/thing/run
```

Then, in order of how much they need from you:

```sh
# 1. agent only — no channel, no Slack. Asserts interrupt → resume → completion.
uv run probe.py
uv run probe.py --decline

# 2. agent + channel, still no Slack: FakeAdapter stands in for the platform.
#    Asserts the picker, the click, and that the resume leaves in the LEGACY
#    forwardedProps.command.resume shape.
cd .. && pnpm tsx e2e/route-b-interrupt.ts

# 3. the real thing — needs SLACK_BOT_TOKEN + SLACK_APP_TOKEN in ../.env
cd .. && pnpm tsx app/route-b.ts
```

Then DM the bot (or @mention it): _"create a thing called widget"_.

Both `.ts` files are deliberately JSX-free — they post the picker through
`confirmThingCard()` instead. JSX would force them to `.tsx`, and in `e2e/` it
would additionally need `--tsconfig e2e/tsconfig.json` (the parent tsconfig
excludes that directory, so JSX there compiles with the classic React transform
and dies on `React is not defined`). Typecheck the harnesses with:

```sh
pnpm exec tsc --noEmit -p e2e/tsconfig.json
```

## Limits

`MemorySaver` keeps the suspended graph in this process's memory, so restarting
`serve.py` mid-interrupt loses it — a click afterwards resumes nothing. Swap in a
real checkpointer (`langgraph-checkpoint-postgres`/`-sqlite`) to test approving
after a redeploy. Restarting the _channel_ is the other half of that story, and
is what `components: [ConfirmThing]` in `route-b.ts` is for.
