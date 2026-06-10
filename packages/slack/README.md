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
- **Inbound files** — uploaded images, audio, video, and PDFs are
  downloaded and delivered to the agent as AG-UI multimodal content
  parts; CSV / JSON / text are decoded inline. The bridge is
  transport-only — the model consumes whatever modalities it supports
  (most read images and PDFs; far fewer accept audio/video). A tool can
  post a file back out via `postFile`.
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

## Deploying

The bridge is a single long-lived Node process.

- **No public URL needed (Socket Mode, the default).** It only makes
  outbound HTTPS + a WebSocket to Slack, so it runs anywhere — a
  container, a VM, a Fly/Render/Railway worker, a k8s `Deployment`. HTTP
  mode (`socketMode: false`) instead needs a public endpoint and
  `slackSigningSecret`.
- **Stateless → restart-safe, single replica.** Slack is the source of
  truth; the bridge keeps no durable storage and rebuilds conversation
  context from Slack history on every turn. In-flight HITL/interrupt
  waits live in memory, but a button click still recovers after a
  restart because the resume value is baked into the button (see
  [`ARCHITECTURE.md`](./ARCHITECTURE.md)). Running more than one replica
  is possible but duplicates event handling — prefer a single instance.
- **Secrets** — supply `slackBotToken` (`xoxb-`), `slackAppToken`
  (`xapp-`, Socket Mode), optional `slackSigningSecret` (HTTP mode), and
  any `agentHeaders` (agent auth) via your platform's secret store / env.
  Never commit them.
- **Rate limits** — Slack `429`s are retried automatically, honoring each
  response's `Retry-After`; tune with `retryConfig`.
- Run the **agent backend** as its own service (the AG-UI server
  `AGENT_URL` points at). [`examples/slack`](../../examples/slack) ships
  one (Next.js + LangGraph) with a `Dockerfile`.

`AGENT_URL` can point at any AG-UI HTTP endpoint:

```env
AGENT_URL=https://your-deployment.example.com/api/copilotkit
AGENT_AUTH_HEADER=Bearer your-token
```

## Troubleshooting

- **Bot doesn't respond to @mentions** — confirm it's invited to the
  channel; check the `app_mention` / `message.im` scopes and event
  subscriptions in your manifest; verify `slackBotToken` / `slackAppToken`.
- **`not_authed` / `invalid_auth`** — wrong or expired token, or the
  `xapp-` token is missing the `connections:write` scope.
- **Bot replies to itself / loops** — the bridge skips its own messages
  using the bot user id it resolves at startup. If `auth.test` failed on
  boot the guard is weaker — check the startup logs for
  `[slack-bridge] auth.test failed`.
- **Streaming reply stops updating mid-stream** — usually the WebClient
  backing off a `429` (honoring `Retry-After`) or a genuinely failed
  edit; look for `[message-stream] update failed` in the logs.
- **An interrupt / HITL picker click does nothing** — the graph stays
  paused when no handler matches the event name, or when the stored
  payload fails schema validation. Check for
  `[turn-runner] … failed validation` warnings.
- **More logs** — set `logLevel: LogLevel.DEBUG` in `createSlackBridge`.

## What's not here yet

- **Modals / shortcuts / home tab** — Block Kit inside threads only.
- **Multi-workspace install (OAuth)** — single-workspace bot token today;
  the customer-workspace install/OAuth path is future work.
