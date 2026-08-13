import assert from "node:assert/strict";
import test from "node:test";
import type { AgentCreateParams } from "@anthropic-ai/sdk/resources/beta/agents/agents";

import { provisionAgentResources } from "./setup.ts";

function createCapturingClient() {
  let agentParams: AgentCreateParams | undefined;
  const client = {
    beta: {
      environments: {
        create: async () => ({ id: "env_test" }),
        delete: async () => ({
          id: "env_test",
          type: "environment_deleted" as const,
        }),
      },
      agents: {
        create: async (params: AgentCreateParams) => {
          agentParams = params;
          return { id: "agent_test", version: 1 };
        },
      },
    },
  };
  return { client, getAgentParams: () => agentParams };
}

test("disables the complete built-in agent toolset", async () => {
  const { client, getAgentParams } = createCapturingClient();

  await provisionAgentResources(client, { log() {}, error() {} });

  assert.deepEqual(getAgentParams()?.tools, [
    {
      type: "agent_toolset_20260401",
      default_config: { enabled: false },
    },
  ]);
});

test("does not instruct the agent to use disabled built-in tools", async () => {
  const { client, getAgentParams } = createCapturingClient();

  await provisionAgentResources(client, { log() {}, error() {} });

  assert.doesNotMatch(
    String(getAgentParams()?.system),
    /\b(?:bash|files?|web_search|web_fetch)\b/i,
  );
});

test("deletes the environment when agent creation fails", async () => {
  const failure = new Error("agent creation failed");
  const deletedEnvironmentIds: string[] = [];
  const client = {
    beta: {
      environments: {
        create: async () => ({ id: "env_test" }),
        delete: async (environmentId: string) => {
          deletedEnvironmentIds.push(environmentId);
          return { id: environmentId, type: "environment_deleted" as const };
        },
      },
      agents: {
        create: async () => {
          throw failure;
        },
      },
    },
  };

  await assert.rejects(
    provisionAgentResources(client, { log() {}, error() {} }),
    (error) => error === failure,
  );
  assert.deepEqual(deletedEnvironmentIds, ["env_test"]);
});

test("returns the created IDs without cleanup when provisioning succeeds", async () => {
  const deletedEnvironmentIds: string[] = [];
  const client = {
    beta: {
      environments: {
        create: async () => ({ id: "env_test" }),
        delete: async (environmentId: string) => {
          deletedEnvironmentIds.push(environmentId);
          return { id: environmentId, type: "environment_deleted" as const };
        },
      },
      agents: {
        create: async () => ({ id: "agent_test", version: 3 }),
      },
    },
  };

  const ids = await provisionAgentResources(client, { log() {}, error() {} });

  assert.deepEqual(ids, {
    environmentId: "env_test",
    agentId: "agent_test",
  });
  assert.deepEqual(deletedEnvironmentIds, []);
});

test("preserves the original error and reports the environment ID if cleanup fails", async () => {
  const failure = new Error("agent creation failed");
  const messages: string[] = [];
  const client = {
    beta: {
      environments: {
        create: async () => ({ id: "env_needs_manual_cleanup" }),
        delete: async () => {
          throw new Error("cleanup failed");
        },
      },
      agents: {
        create: async () => {
          throw failure;
        },
      },
    },
  };

  await assert.rejects(
    provisionAgentResources(client, {
      log() {},
      error(message: string) {
        messages.push(message);
      },
    }),
    (error) => error === failure,
  );
  assert.match(messages.join("\n"), /env_needs_manual_cleanup/);
});
