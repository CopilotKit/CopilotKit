# @copilotkit/channels-intelligence

`@copilotkit/channels-intelligence` is the early-access transport between a named CopilotKit Channels bot and Managed Channels. Intelligence owns durable channel delivery and provider egress; your infrastructure runs the agent, tools, and application behavior.

## Prerequisites

- Node.js 22 or newer for the built-in WebSocket implementation
- An AG-UI agent endpoint
- An Intelligence project, project runtime API key, and configured Slack Channel
- The runtime handoff values copied from that Channel

Intelligence stores the Slack `xapp-` and `xoxb-` credentials. Do not put Slack tokens in the runtime environment.

## Install

```bash
npm install @copilotkit/channels@0.1.1 \
  @copilotkit/channels-slack@0.1.2 \
  @copilotkit/channels-intelligence@0.1.1 dotenv
npm install -D typescript tsx @types/node
```

## Quickstart

```ts
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createBot } from "@copilotkit/channels";
import { SanitizingHttpAgent } from "@copilotkit/channels-slack";
import { startChannelsOverRealtimeGateway } from "@copilotkit/channels-intelligence";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const projectId = Number(required("INTELLIGENCE_PROJECT_ID"));
if (!Number.isInteger(projectId) || projectId <= 0) {
  throw new Error("INTELLIGENCE_PROJECT_ID must be a positive integer");
}

const channelName = required("INTELLIGENCE_CHANNEL_NAME");
const channel = createBot({
  name: channelName,
  agent: (threadId) => {
    const agent = new SanitizingHttpAgent({ url: required("AGENT_URL") });
    agent.threadId = threadId;
    return agent;
  },
});

channel.onMention(async ({ thread, message }) => {
  await thread.runAgent({
    prompt: message.contentParts?.length
      ? message.contentParts
      : message.text,
  });
});

const handle = await startChannelsOverRealtimeGateway([channel], {
  wsUrl: required("INTELLIGENCE_GATEWAY_WS_URL"),
  apiKey: required("INTELLIGENCE_API_KEY"),
  scope: {
    organizationId: required("INTELLIGENCE_ORG_ID"),
    projectId,
    channelId: required("INTELLIGENCE_CHANNEL_ID"),
    channelName,
  },
  runtimeInstanceId: `rti_${randomUUID().replaceAll("-", "")}`,
  adapter: "slack",
});

async function shutdown(): Promise<void> {
  await handle.stop();
  process.exit(0);
}

process.once("SIGINT", () => {
  shutdown().catch((error: unknown) => {
    console.error("Failed to stop Managed Channel", error);
    process.exit(1);
  });
});
process.once("SIGTERM", () => {
  shutdown().catch((error: unknown) => {
    console.error("Failed to stop Managed Channel", error);
    process.exit(1);
  });
});
```

Run the process with `npx tsx channel.ts`, mention the app in Slack, and verify the reply in Slack and the Intelligence Channel timeline.

## Configuration

| Environment variable | Description |
|---|---|
| `AGENT_URL` | AG-UI endpoint that runs your agent. |
| `INTELLIGENCE_GATEWAY_WS_URL` | Outbound Realtime Gateway WebSocket URL from the Channel handoff. |
| `INTELLIGENCE_API_KEY` | Project runtime API key. |
| `INTELLIGENCE_ORG_ID` | Intelligence organization ID, prefixed with `org_`. |
| `INTELLIGENCE_PROJECT_ID` | Positive integer project ID. |
| `INTELLIGENCE_CHANNEL_ID` | Intelligence Channel ID, prefixed with `channel_`. |
| `INTELLIGENCE_CHANNEL_NAME` | Lowercase kebab-case Channel name. It must match the bot name and handoff exactly. |

## Lifecycle and reconnect behavior

`startChannelsOverRealtimeGateway` resolves after the gateway connection is authenticated and joined and the bot is running. The gateway client reconnects and rejoins after transient connection loss while the handle remains active. Call `handle.stop()` during shutdown to stop the bot and disconnect the session; the quickstart handles `SIGINT` and `SIGTERM` for you.

Startup rejects invalid Channel names and scopes before opening a socket. Authentication, join, or timeout failures disconnect the startup session. If bot startup fails after joining, the launcher also disconnects before rethrowing.

## Troubleshooting

- **Slack credentials are rejected:** confirm the app and bot tokens belong to the same Slack app and workspace, then re-enter them in Intelligence.
- **Authentication or join fails:** create a current project runtime API key and verify the project ID.
- **Channel name mismatch:** copy the Channel name from the handoff exactly.
- **No active runtime:** keep the runtime process running and verify every Intelligence value came from the same handoff.
- **Reconnect loop:** check WebSocket reachability and proxy support, then stop duplicate processes declaring the same Channel.

## Early-access limitations

- Managed Slack is the current early-access provider path; Managed Teams is not included.
- Run one named bot per gateway session.
- Intelligence operates the provider edge but does not host or execute your agent.
- OAuth and Slack Marketplace installation are outside this package's current setup path.

Follow the [Managed Slack early-access guide](https://docs.copilotkit.ai/channels/managed/slack) for the full journey. See the [`startChannelsOverRealtimeGateway` reference](https://docs.copilotkit.ai/reference/channels/intelligence) for configuration and failure behavior.
