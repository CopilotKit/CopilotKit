import { Observable } from "rxjs";
import { describe, expect, it } from "vitest";
import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import type { CopilotRuntime } from "../core/runtime";
import { handleConnectAgent } from "../handlers/handle-connect";
import { resolveForwardHeadersPolicy } from "../handlers/header-utils";
import { configureAgentForRequest } from "../handlers/shared/agent-utils";

const input = {
  threadId: "thread-1",
  runId: "run-1",
  state: {},
  messages: [],
  tools: [],
  context: [],
  forwardedProps: {},
};

function createRuntime(agent: AbstractAgent): CopilotRuntime {
  return {
    agents: Promise.resolve({ "test-agent": agent }),
    forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
    runner: {
      connect: () =>
        new Observable<BaseEvent>((subscriber) => subscriber.complete()),
    },
  } as unknown as CopilotRuntime;
}

describe("connect request-header parity", () => {
  it("configures the connect clone with the /run merge", async () => {
    const clones: Array<AbstractAgent & { headers?: Record<string, string> }> =
      [];
    const registeredAgent = {
      headers: undefined,
      clone: () => {
        const clone = {
          headers: undefined,
          use: () => {},
        } as unknown as AbstractAgent & { headers?: Record<string, string> };
        clones.push(clone);
        return clone;
      },
    };
    const runtime = createRuntime(registeredAgent as unknown as AbstractAgent);
    const request = new Request(
      "https://example.com/agent/test-agent/connect",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer forwarded-token",
          "X-Tenant-Id": "acme",
          "X-Forwarded-For": "203.0.113.7",
          "X-CopilotCloud-Public-Api-Key": "ck_test",
        },
        body: JSON.stringify(input),
      },
    );

    await handleConnectAgent({ runtime, request, agentId: "test-agent" });

    const runClone = {
      headers: undefined,
      use: () => {},
    } as AbstractAgent & { headers?: Record<string, string> };
    configureAgentForRequest({
      runtime,
      request,
      agentId: "test-agent",
      agent: runClone,
    });

    expect(clones[0].headers).toEqual(runClone.headers);
    expect(clones[0].headers).toEqual({
      authorization: "Bearer forwarded-token",
      "x-tenant-id": "acme",
    });
    expect(clones[0].headers).not.toHaveProperty("x-forwarded-for");
    expect(clones[0].headers).not.toHaveProperty(
      "x-copilotcloud-public-api-key",
    );
    expect(registeredAgent.headers).toBeUndefined();
  });

  it("keeps server Authorization on the clone without a duplicate key", async () => {
    let clone!: AbstractAgent & { headers?: Record<string, string> };
    const registeredAgent = {
      headers: { Authorization: "Bearer service-token" },
      clone: () => {
        clone = {
          headers: { Authorization: "Bearer service-token" },
          use: () => {},
        } as unknown as AbstractAgent & { headers?: Record<string, string> };
        return clone;
      },
    };

    await handleConnectAgent({
      runtime: createRuntime(registeredAgent as unknown as AbstractAgent),
      request: new Request("https://example.com/agent/test-agent/connect", {
        method: "POST",
        headers: {
          Authorization: "Bearer inbound-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      }),
      agentId: "test-agent",
    });

    expect(clone.headers).toEqual({ Authorization: "Bearer service-token" });
    expect(clone.headers).not.toHaveProperty("authorization");
  });

  it("sets an empty clone header object when nothing is forwardable", async () => {
    let clone!: AbstractAgent & { headers?: Record<string, string> };
    const registeredAgent = {
      clone: () => {
        clone = { use: () => {} } as AbstractAgent & {
          headers?: Record<string, string>;
        };
        return clone;
      },
    };

    await handleConnectAgent({
      runtime: createRuntime(registeredAgent as unknown as AbstractAgent),
      request: new Request("https://example.com/agent/test-agent/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://example.com",
        },
        body: JSON.stringify(input),
      }),
      agentId: "test-agent",
    });

    expect(clone.headers).toEqual({});
  });
});
