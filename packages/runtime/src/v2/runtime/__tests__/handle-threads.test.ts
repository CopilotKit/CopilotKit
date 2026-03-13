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
  it("returns 422 when intelligence is not configured for listThreads", async () => {
    const runtime = new CopilotRuntime({ agents: {} });

    const response = await handleListThreads({
      runtime,
      request: new Request(
        "https://example.com/threads?userId=user-1&agentId=agent-1",
      ),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error:
        "Missing CopilotKitIntelligence configuration. Thread operations require a CopilotKitIntelligence instance to be provided in CopilotRuntime options.",
    });
  });

  it("returns 422 when intelligence is not configured for thread mutations", async () => {
    const runtime = new CopilotRuntime({ agents: {} });
    const mutationRequest = new Request(
      "https://example.com/threads/thread-1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user-1", agentId: "agent-1" }),
      },
    );

    const updateResponse = await handleUpdateThread({
      runtime,
      request: mutationRequest.clone(),
      threadId: "thread-1",
    });
    expect(updateResponse.status).toBe(422);

    const archiveResponse = await handleArchiveThread({
      runtime,
      request: mutationRequest.clone(),
      threadId: "thread-1",
    });
    expect(archiveResponse.status).toBe(422);

    const deleteResponse = await handleDeleteThread({
      runtime,
      request: mutationRequest.clone(),
      threadId: "thread-1",
    });
    expect(deleteResponse.status).toBe(422);
  });

  it("returns 422 when intelligence is not configured for thread subscription", async () => {
    const runtime = new CopilotRuntime({ agents: {} });

    const response = await handleSubscribeToThreads({
      runtime,
      request: new Request("https://example.com/threads/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user-1" }),
      }),
    });

    expect(response.status).toBe(422);
  });
});
