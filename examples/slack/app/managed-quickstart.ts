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
    prompt: message.contentParts?.length ? message.contentParts : message.text,
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
