import { createServer } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { HttpAgent } from "@ag-ui/client";
import { ManagedAgentsAgent } from "@ag-ui/claude-managed-agents";
import {
  CopilotKitIntelligence,
  CopilotRuntime,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import nextEnv from "@next/env";
import { intelligenceConfig } from "./lib/intelligence-config";
import { createSkillsFetch } from "./lib/native-skills";
import { requireStack, sessionStore } from "./lib/stack";

nextEnv.loadEnvConfig(process.cwd());

function createRuntime(): CopilotRuntime {
  if (process.env.AGENT_URL) {
    return new CopilotRuntime({
      agents: { default: new HttpAgent({ url: process.env.AGENT_URL }) },
      runner: new InMemoryAgentRunner(),
    });
  }

  const config = intelligenceConfig(process.env);
  const intelligence = new CopilotKitIntelligence(config.intelligence);
  const nativeClient = new Anthropic();
  const client = new Anthropic({
    maxRetries: 0,
    fetch: createSkillsFetch({
      intelligence,
      containerId: config.containerId,
      skills: nativeClient.beta.skills,
      agents: nativeClient.beta.agents,
    }),
  });
  const { agentId, environmentId } = requireStack();
  return new CopilotRuntime({
    agents: {
      default: new ManagedAgentsAgent({
        managedAgentId: agentId,
        environmentId,
        client,
        sessionStore: sessionStore(),
        toolConfirmation: "allow",
        onError: (_error, context) =>
          console.error("Managed Agents operation failed", context),
      }),
    },
    intelligence,
    identifyUser: () => ({ id: config.userId, name: "Local Developer" }),
  });
}

const port = Number(process.env.RUNTIME_PORT ?? 8200);
const host = process.env.RUNTIME_HOST ?? "127.0.0.1";
createServer(
  createCopilotNodeListener({
    runtime: createRuntime(),
    basePath: "/api/copilotkit",
    cors: true,
  }),
).listen(port, host, () => {
  console.log(
    `Copilot Runtime listening at http://${host}:${port}/api/copilotkit`,
  );
});
