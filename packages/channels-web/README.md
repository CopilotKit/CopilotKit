# @copilotkit/channels-web

The **Web `PlatformAdapter`** for [`@copilotkit/channels`](../channels). It
lets any [AG-UI](https://docs.ag-ui.com) client talk to a Channel over HTTP:
`HttpAgent` from `@ag-ui/client`, CopilotKit, or your own client.

- Each request is one AG-UI run. The body is a standard `RunAgentInput`.
- The response is an AG-UI event stream (SSE).
- Posted JSX arrives as a `channels.ui` custom event. The
  `@copilotkit/channels-web/react` entry renders it and sends clicks back.

The Channel runs in your own process: call `channel.start()`. No
Intelligence key is needed.

## Install

```sh
pnpm add @copilotkit/channels @copilotkit/channels-web
```

## Quickstart

```ts
import { createChannel } from "@copilotkit/channels";
import { web } from "@copilotkit/channels-web";

const webAdapter = web({
  // Optional. Return null for an anonymous visitor; throw to answer 401.
  getUser: async (request) => sessionUser(request),
});

const channel = createChannel({
  identifyUser: "platform",
  adapters: [webAdapter],
  agent: makeAgent,
});

// Every web message is addressed to the bot (`mentioned: true`), so it
// reaches `onMention` handlers, or `onMessage` when there are none.
channel.onMessage(async ({ thread }) => {
  await thread.runAgent();
});

await channel.start();

// Mount the fetch-style handler on any route (Next.js, Hono, Bun, Workers…):
export const POST = webAdapter.handler;
```

Or let the adapter run its own `node:http` server:

```ts
web({
  port: 3001,
  path: "/api/channel",
  allowedOrigins: ["http://localhost:3000"],
});
```

## Client

```ts
import { HttpAgent } from "@ag-ui/client";

const agent = new HttpAgent({ url: "/api/channel", threadId: "chat-1" });
agent.addMessage({ id: crypto.randomUUID(), role: "user", content: "Hi" });
await agent.runAgent();
```

The client sends the whole conversation with each request. The agent uses
that history, so the adapter keeps no transcript on the server.

### React

```tsx
import {
  ChannelUi,
  useChannelUi,
  sendChannelInteraction,
} from "@copilotkit/channels-web/react";

function Card({ agent, messageId }) {
  const ui = useChannelUi(agent);
  const ir = ui.get(messageId);
  if (!ir) return null;
  return (
    <ChannelUi
      ir={ir}
      messageId={messageId}
      onAction={(interaction) => sendChannelInteraction(agent, interaction)}
    />
  );
}
```

## Wire format

| Server call              | Events in the response                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `thread.runAgent()`      | The agent's AG-UI events (text, tool calls, state, custom)                                 |
| `thread.post(ui)`        | `TEXT_MESSAGE_*` with plain fallback text, then `CUSTOM` `channels.ui` `{ messageId, ir }` |
| `thread.update(ref, ui)` | `CUSTOM` `channels.ui` with the same `messageId` (replace)                                 |
| `thread.delete(ref)`     | `CUSTOM` `channels.ui.delete` `{ messageId }`                                              |
| `thread.stream(chunks)`  | `TEXT_MESSAGE_*` deltas                                                                    |

A click is a new run request with
`forwardedProps.channelInteraction = { id, value?, values?, messageId? }`.
`id` is the control's minted action id (its `onClick`, `onSelect`, or
`onSubmit` prop in the IR).

## Limits

- Output goes to the open request for its conversation (`threadId`). When no
  request is open, the output is dropped. There is no proactive delivery.
- No reactions, modals, ephemeral messages, typing, suggested prompts, or
  thread titles. `awaitChoice` cannot block across requests; use
  `onInterrupt` and `thread.resume()` instead.
