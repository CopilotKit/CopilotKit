# @ag-ui/a2a

A TypeScript integration that connects AG-UI agents with remote services that expose the [A2A protocol](https://a2a.dev/). It converts AG-UI conversations into A2A payloads, forwards them through the official A2A SDK, and replays the responses back into AG-UI event streams.

> **Status:** Experimental. APIs may change while the integration stabilises.

## Features

- Message conversion helpers between AG-UI and A2A formats (user, assistant, tool, binary payloads).
- `A2AAgent` implementation that streams or performs blocking requests against A2A endpoints.
- Optional fallback from streaming to blocking requests when an agent does not support SSE.
- Event conversion utilities that surface A2A messages, task status updates, and artifact chunks as AG-UI events.
- Helper tool schema (`send_message_to_a2a_agent`) for orchestration scenarios.
- Example client and Jest tests to validate conversions and streaming flows.

## Installation

Once dependencies are installed in the monorepo:

```bash
pnpm install
pnpm --filter @ag-ui/a2a build
```

## Quick start

```ts
import { A2AAgent } from "@ag-ui/a2a";

import { A2AClient } from "@a2a-js/sdk/client";

const client = new A2AClient("https://my-a2a-agent");

const agent = new A2AAgent({
  a2aClient: client,
  initialMessages: [
    { id: "user-1", role: "user", content: "Plan a team offsite" } as any,
  ],
});

const { result, newMessages } = await agent.runAgent();
console.log(result);
console.log(newMessages);
```

You can inject your own `A2AClient` instance via the `client` option, override default instructions, or force blocking mode by setting `strategy: "blocking"`.

## Configuration reference

| Option | Description |
| ------ | ----------- |
| `a2aClient` | Required. Provide an `A2AClient` instance (with any auth headers or custom fetch logic you need). |

## Environment variables & authentication

The integration relies on the underlying A2A agent for authentication. Common patterns include:

- `A2A_AGENT_URL` – set in deployment environments to point to the remote agent base URL.
- `A2A_API_KEY` or `A2A_BEARER_TOKEN` – consumed by a wrapped `fetch` inside a custom `A2AClient` instance if the remote agent enforces API key or bearer authentication.

Pass any credentials to the `A2AClient` you provide to `A2AAgent`, or configure an HTTP proxy that injects the correct headers.

## Utilities

- `convertAGUIMessagesToA2A(messages, options)` — reshapes AG-UI history into A2A message objects, forwarding only user/assistant/tool turns and preserving the tool payloads.
- `convertA2AEventToAGUIEvents(event, options)` — maps an A2A stream event to AG-UI text and tool events (`TEXT_MESSAGE_CHUNK`, `TOOL_CALL_*`, `TOOL_CALL_RESULT`).
- `sendMessageToA2AAgentTool` — JSON schema describing a `send_message_to_a2a_agent` tool for orchestration agents.

## Testing

```bash
pnpm --filter @ag-ui/a2a test
```

The suite covers conversion edge cases and streaming / fallback behaviour using mocked A2A clients.

## Examples

- `examples/basic.ts` – minimal script. If you set `A2A_AGENT_URL`, it will connect to that agent through the real `A2AClient`. Otherwise it falls back to a tiny in-memory mock client so you can observe the integration without hitting a remote endpoint.

## Release checklist

1. `pnpm --filter @ag-ui/a2a build`
2. `pnpm --filter @ag-ui/a2a test`
3. Update CHANGELOG / release notes.
4. Publish with `pnpm publish --filter @ag-ui/a2a`.
