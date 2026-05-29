# @copilotkit/slack

A Slack frontend for **any AG-UI agent**. Connect a Slack workspace to
a CopilotKit Runtime, LangGraph server, or any other AG-UI HTTP
endpoint — Slack becomes another frontend the same way React /
Angular / Vue are.

The bridge handles:

- **Text streaming** — `chat.update`-throttled in-place edits with
  multi-message chunking, auto-close on dangling markdown brackets,
  and Markdown → Slack mrkdwn translation (column-aligned tables, link
  syntax, etc.).
- **Frontend tools** — `FrontendTool<Schema>` declarations forwarded
  to the agent via `runAgent({tools})`. `Schema` is any
  [Standard Schema](https://standardschema.dev) (Zod 3.24+/v4, Valibot,
  ArkType, …) → JSON Schema for the LLM; validated on the way back.
  Ships with `lookup_slack_user` by default so the agent can
  `<@USERID>`-mention people.
- **Components** — `defineSlackComponent` is the Slack equivalent of
  React's `useComponent`. The agent calls it like a tool; the bridge
  renders Block Kit and posts.
- **Human-in-the-loop** — `defineHumanInTheLoop` posts an interactive
  picker, blocks the tool call on a click, and resumes with the
  user's response. Resolution renders replace the picker in place via
  Slack's `response_url`.
- **LangGraph interrupts** — `defineInterruptHandler` captures
  `on_interrupt` AG-UI custom events, renders a Block Kit picker,
  awaits the click, and resumes the graph via
  `runAgent({forwardedProps:{command:{resume}}})`.
- **Interrupt-on-new-message** — a fresh user reply mid-stream aborts
  the in-flight agent run, marks the partial reply
  `_(interrupted)_`, and cancels any pending HITL/interrupt waits.
- **No durable bridge state** — Slack itself is the source of truth.
  Restarts rebuild conversation history from `conversations.replies`
  on the next turn.

## Running the demo

This package is the **library**. A runnable end-to-end demo — a sample
app wiring all of the above, a vendored AG-UI agent backend, and a
live-Slack e2e harness — lives in
[`examples/slack`](../../examples/slack). Start there to see the bridge
working against a real workspace.

---

## SDK quickstart

### Defining a frontend tool

`parameters` accepts any [Standard Schema](https://standardschema.dev)
validator — Zod, Valibot, ArkType, etc. The examples below use Zod, but
nothing in the SDK's public API is tied to it.

```ts
import { z } from "zod";
import { type FrontendTool } from "@copilotkit/slack";

const searchSchema = z.object({ q: z.string() });
const searchTool: FrontendTool<typeof searchSchema> = {
  name: "search_docs",
  description: "Search the company knowledge base",
  parameters: searchSchema,
  async handler({ q }, ctx) {
    return JSON.stringify(await callMyService(q));
  },
};
```

### Defining a render-only component

```ts
const flightCard = defineSlackComponent({
  name: "flight_card",
  description: "Render a flight option as a card",
  props: z.object({ airline: z.string(), price: z.string() }),
  render({ airline, price }) {
    return [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${airline}* ${price}` },
      },
    ];
  },
});
```

### Defining an interactive (human-in-the-loop) component

```ts
const confirmHitl = defineHumanInTheLoop({
  name: "confirm",
  description: "Ask the user to confirm before proceeding",
  props: z.object({ question: z.string() }),
  render(state, api) {
    if (state.status === "pending") {
      return [
        { type: "section", text: { type: "mrkdwn", text: state.props.question } },
        { type: "actions", elements: [
          { type: "button", text: …, action_id: api.respond({ confirmed: true })  },
          { type: "button", text: …, action_id: api.respond({ confirmed: false }) },
        ]},
      ];
    }
    if (state.status === "resolved") {
      const v = state.value as { confirmed: boolean };
      return [{ type: "section", text: { type: "mrkdwn", text: v.confirmed ? "✅" : "❌" } }];
    }
    if (state.status === "cancelled") return "delete";
    return "noop";
  },
});
```

### Defining an interrupt handler

```ts
const pickerInterrupt = defineInterruptHandler({
  name: "schedule_meeting_picker",
  description: "Render a time-slot picker for the schedule_meeting interrupt",
  payload: z.object({
    topic: z.string(),
    slots: z.array(z.object({ label: z.string(), iso: z.string() })),
  }),
  render(state, api) {
    if (state.status === "pending") {
      return state.payload.slots.map((s) => ({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: s.label },
            action_id: api.respond({
              chosen_time: s.iso,
              chosen_label: s.label,
            }),
          },
        ],
      }));
    }
    // …resolved / cancelled / timeout
    return "noop";
  },
});
```

### Wiring everything

```ts
import {
  createSlackBridge,
  defaultSlackTools,
  defaultSlackContext,
} from "@copilotkit/slack";

createSlackBridge({
  agentUrl: process.env.AGENT_URL!,
  slackBotToken: process.env.SLACK_BOT_TOKEN!,
  slackAppToken: process.env.SLACK_APP_TOKEN!,
  tools: [...defaultSlackTools, searchTool], // includes lookup_slack_user
  context: [...defaultSlackContext, ...appContext], // tagging/mrkdwn/thread guidance
  components: [flightCard],
  humanInTheLoopComponents: [confirmHitl],
  interruptHandlers: [pickerInterrupt],
  // showToolStatus: true   // opt in to `:wrench:/:white_check_mark:` status rows
});
```

See [`examples/slack/app`](../../examples/slack/app) for a worked
example wiring all of the above.

## What's not here yet

- **Modals / shortcuts / home tab** — Block Kit inside threads only.
- **File uploads** — both directions, deferred.
- **Slack rate-limit handling** — current code swallows 429s; future
  work is to respect `Retry-After`.
- **Multi-workspace deploy** — single-workspace today.

## Pointing at a different AG-UI agent

```env
# Default beautiful_chat
AGENT_URL=http://localhost:8200/

# Interrupt demo
AGENT_URL=http://localhost:8200/interrupt

# Anything that speaks AG-UI works
AGENT_URL=https://your-deployment.example.com/api/copilotkit
AGENT_AUTH_HEADER=Bearer your-token
```
