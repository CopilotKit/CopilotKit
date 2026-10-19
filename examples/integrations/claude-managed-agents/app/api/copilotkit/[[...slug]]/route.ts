import Anthropic from "@anthropic-ai/sdk";
import {
  CopilotKitIntelligence,
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { ManagedAgentsAgent } from "@ag-ui/claude-managed-agents";
import { fillEmptyToolResults } from "@/lib/tool-results";
import { createSkillsFetch } from "@/lib/native-skills";
import { intelligenceConfig } from "@/lib/intelligence-config";
import { requireStack, sessionStore } from "@/lib/stack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One runtime per process; development reloads retain thread/session mappings. */
function createHandler() {
  if (process.env.AGENT_URL)
    return createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({
        agents: { default: new HttpAgent({ url: process.env.AGENT_URL }) },
        runner: new InMemoryAgentRunner(),
      }),
      basePath: "/api/copilotkit",
    });
  const config = intelligenceConfig(process.env);
  const intelligence = new CopilotKitIntelligence(config.intelligence);
  const nativeClient = new Anthropic(); // SDK resolves and refreshes Ant OAuth.
  const client = new Anthropic({
    maxRetries: 0, // Do not repeat session creation or Skill preparation on transport errors.
    fetch: createSkillsFetch({
      intelligence,
      containerId: config.containerId,
      skills: nativeClient.beta.skills,
      agents: nativeClient.beta.agents,
    }),
  });
  const { agentId, environmentId } = requireStack();
  return createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({
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
      // This localhost starter has one developer identity. Replace with verified
      // request authentication before exposing it to multiple users.
      identifyUser: () => ({ id: config.userId, name: "Local Developer" }),
    }),
    basePath: "/api/copilotkit",
  });
}

const shared = globalThis as typeof globalThis & {
  claudeCopilotHandler?: ReturnType<typeof createHandler>;
};
/** Lazily configure on the server so builds need no credentials. */
function handler() {
  return (shared.claudeCopilotHandler ??= createHandler());
}
export const GET = (request: Request) => handler()(request);
export const POST = async (request: Request) =>
  handler()(await fillEmptyToolResults(request));
export const PATCH = (request: Request) => handler()(request);
export const DELETE = (request: Request) => handler()(request);
