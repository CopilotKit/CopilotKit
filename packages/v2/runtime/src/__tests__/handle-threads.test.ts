import { describe, expect, it } from "vitest";

import {
  handleArchiveThread,
  handleDeleteThread,
  handleListThreads,
  handleSubscribeToThreads,
  handleUpdateThread,
} from "../handlers/handle-threads";
import { CopilotRuntime } from "../runtime";

describe("thread handlers", () => {
  it("returns 501 in SSE mode for listThreads", async () => {
    const runtime = new CopilotRuntime({ agents: {} });

    const response = await handleListThreads({
      runtime,
      request: new Request(
        "https://example.com/threads?userId=user-1&agentId=agent-1",
      ),
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error:
        "Threads are only available in Intelligence mode. Provide intelligenceSdk in CopilotRuntime options.",
    });
  });

  it("returns 501 in SSE mode for thread mutations", async () => {
    const runtime = new CopilotRuntime({ agents: {} });
    const mutationRequest = new Request("https://example.com/threads/thread-1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user-1", agentId: "agent-1" }),
    });

    const updateResponse = await handleUpdateThread({
      runtime,
      request: mutationRequest.clone(),
      threadId: "thread-1",
    });
    expect(updateResponse.status).toBe(501);

    const archiveResponse = await handleArchiveThread({
      runtime,
      request: mutationRequest.clone(),
      threadId: "thread-1",
    });
    expect(archiveResponse.status).toBe(501);

    const deleteResponse = await handleDeleteThread({
      runtime,
      request: mutationRequest.clone(),
      threadId: "thread-1",
    });
    expect(deleteResponse.status).toBe(501);
  });

  it("returns 501 in SSE mode for thread subscription", async () => {
    const runtime = new CopilotRuntime({ agents: {} });

    const response = await handleSubscribeToThreads({
      runtime,
      request: new Request("https://example.com/threads/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user-1" }),
      }),
    });

    expect(response.status).toBe(501);
  });
});
