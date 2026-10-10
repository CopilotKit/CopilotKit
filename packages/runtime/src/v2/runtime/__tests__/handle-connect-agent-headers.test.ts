import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../handlers/sse/connect", () => ({
  handleSseConnect: vi.fn(() => new Response("mocked-connect")),
}));

import { handleSseConnect } from "../handlers/sse/connect";
import { handleConnectAgent } from "../handlers/handle-connect";
import type { CopilotRuntime } from "../core/runtime";
import { resolveForwardHeadersPolicy } from "../handlers/header-utils";

const mockedHandleSseConnect = vi.mocked(handleSseConnect);

type HeaderedClone = { headers?: Record<string, string> };

function createRuntime(
  clones: HeaderedClone[],
  serverHeaders?: Record<string, string>,
): CopilotRuntime {
  return {
    agents: Promise.resolve({
      "test-agent": {
        ...(serverHeaders ? { headers: serverHeaders } : {}),
        clone() {
          const clone: HeaderedClone = { ...this };
          clones.push(clone);
          return clone;
        },
      },
    }),
    forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
  } as unknown as CopilotRuntime;
}

function connectRequest(headers: Record<string, string>): Request {
  return new Request("https://example.com/agent/test-agent/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      threadId: "thread-1",
      runId: "run-1",
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {},
    }),
  });
}

function passedAgent(): HeaderedClone {
  expect(mockedHandleSseConnect).toHaveBeenCalledTimes(1);
  return mockedHandleSseConnect.mock.calls[0]?.[0].agent as HeaderedClone;
}

describe("handleConnectAgent — connect-clone header parity (#3170)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies forwardable inbound headers to the connect-path clone like /run does", async () => {
    const clones: HeaderedClone[] = [];
    const runtime = createRuntime(clones);

    const response = await handleConnectAgent({
      runtime,
      request: connectRequest({
        Authorization: "Bearer inbound-token",
        "X-Custom": "custom-value",
        Origin: "http://localhost:4200",
      }),
      agentId: "test-agent",
    });

    expect(response.status).toBe(200);
    expect(passedAgent().headers).toMatchObject({
      authorization: "Bearer inbound-token",
      "x-custom": "custom-value",
    });
    expect(passedAgent().headers).not.toHaveProperty("origin");
  });

  it("lets server-configured headers win over inbound headers on the connect-path clone", async () => {
    const clones: HeaderedClone[] = [];
    const runtime = createRuntime(clones, {
      Authorization: "Bearer service-token",
    });

    const response = await handleConnectAgent({
      runtime,
      request: connectRequest({
        Authorization: "Bearer inbound-token",
        "X-Custom": "custom-value",
      }),
      agentId: "test-agent",
    });

    expect(response.status).toBe(200);
    expect(passedAgent().headers).toMatchObject({
      Authorization: "Bearer service-token",
      "x-custom": "custom-value",
    });
    expect(passedAgent().headers).not.toHaveProperty("authorization");
  });
});
