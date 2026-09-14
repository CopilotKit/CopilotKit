import { expect, test, vi } from "vitest";
import { CopilotKitIntelligence, PlatformRequestError } from "../client";

/** Create one SDK client with isolated transport and lifecycle observations. */
function setup() {
  const thread = { id: "canonical-thread", name: "Updated name" };
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ thread }));
  const updated = vi.fn();
  const client = new CopilotKitIntelligence({
    apiKey: "test-project-key",
    onThreadUpdated: updated,
  });
  return {
    client,
    fetchSpy,
    updated,
    thread,
    teardown: () => fetchSpy.mockRestore(),
  };
}

test("SDK thread updates retain the existing updates precedence for trusted callers", async () => {
  const { client, fetchSpy, updated, thread, teardown } = setup();
  const updates = {
    name: "Updated name",
    userId: "different-user",
    agentId: "different-agent",
    customMetadata: { source: "application" },
  };

  try {
    const result = await client.updateThread({
      threadId: "thread/id",
      userId: "trusted-user",
      agentId: "trusted-agent",
      updates,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, request] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(
      "https://api.intelligence.copilotkit.ai/api/threads/thread%2Fid",
    );
    expect(request?.method).toBe("PATCH");
    expect(JSON.parse(String(request?.body))).toEqual({
      name: "Updated name",
      userId: "different-user",
      agentId: "different-agent",
      customMetadata: { source: "application" },
    });
    expect(updates.userId).toBe("different-user");
    expect(updates.agentId).toBe("different-agent");
    expect(result).toEqual(thread);
    expect(updated).toHaveBeenCalledExactlyOnceWith(thread);
  } finally {
    teardown();
  }
});

test("a denied thread update preserves platform status and emits no success callback", async () => {
  const { client, fetchSpy, updated, teardown } = setup();
  fetchSpy.mockResolvedValueOnce(
    new Response("Access denied", { status: 403 }),
  );

  try {
    const request = client.updateThread({
      threadId: "thread",
      userId: "trusted-user",
      agentId: "trusted-agent",
      updates: { name: "New name" },
    });

    await expect(request).rejects.toBeInstanceOf(PlatformRequestError);
    await expect(request).rejects.toMatchObject({ status: 403 });
    expect(updated).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  } finally {
    teardown();
  }
});
