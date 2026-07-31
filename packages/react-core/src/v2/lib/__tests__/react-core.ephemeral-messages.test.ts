import { describe, expect, it, vi } from "vitest";
import { MockStepwiseAgent } from "../../__tests__/utils/test-helpers";
import { CopilotKitCoreReact } from "../react-core";

describe("CopilotKitCoreReact ephemeral messages", () => {
  it("keeps ordered immutable snapshots and rejects persisted ID collisions", () => {
    const agent = new MockStepwiseAgent();
    agent.threadId = "thread-a";
    agent.addMessage({
      id: "persisted-card",
      role: "user",
      content: "Persisted card-shaped message",
    });
    const core = new CopilotKitCoreReact({
      agents__unsafe_dev_only: { default: agent },
    });

    expect(
      core.addEphemeralMessage("default", "thread-a", {
        id: "first",
        content: { label: "first" },
      }),
    ).toBe(true);
    expect(
      core.addEphemeralMessage("default", "thread-a", {
        id: "second",
        content: { label: "second" },
      }),
    ).toBe(true);
    const initialSnapshot = core.getEphemeralMessages("default", "thread-a");

    expect(
      core.addEphemeralMessage("default", "thread-a", {
        id: "first",
        content: { label: "updated" },
      }),
    ).toBe(true);
    expect(core.getEphemeralMessages("default", "thread-a")).toEqual([
      {
        id: "first",
        content: { label: "updated" },
        anchorMessageId: "persisted-card",
      },
      {
        id: "second",
        content: { label: "second" },
        anchorMessageId: "persisted-card",
      },
    ]);
    expect(initialSnapshot).toEqual([
      {
        id: "first",
        content: { label: "first" },
        anchorMessageId: "persisted-card",
      },
      {
        id: "second",
        content: { label: "second" },
        anchorMessageId: "persisted-card",
      },
    ]);
    expect(
      core.addEphemeralMessage("default", "thread-a", {
        id: "persisted-card",
        content: "must remain persisted",
      }),
    ).toBe(false);
    expect(agent.messages).toHaveLength(1);
  });

  it("isolates scopes and limits remove and clear to the selected scope", () => {
    const core = new CopilotKitCoreReact({});
    core.addEphemeralMessage("agent-a", "thread-a", {
      id: "shared-id",
      content: "A",
    });
    core.addEphemeralMessage("agent-a", "thread-b", {
      id: "shared-id",
      content: "B",
    });
    core.addEphemeralMessage("agent-b", "thread-a", {
      id: "shared-id",
      content: "C",
    });

    expect(
      core.removeEphemeralMessage("agent-a", "thread-a", "shared-id"),
    ).toBe(true);
    expect(core.getEphemeralMessages("agent-a", "thread-a")).toEqual([]);
    expect(core.getEphemeralMessages("agent-a", "thread-b")).toEqual([
      { id: "shared-id", content: "B" },
    ]);
    expect(core.getEphemeralMessages("agent-b", "thread-a")).toEqual([
      { id: "shared-id", content: "C" },
    ]);

    expect(core.clearEphemeralMessages("agent-a", "thread-b")).toBe(true);
    expect(core.getEphemeralMessages("agent-a", "thread-b")).toEqual([]);
    expect(core.clearEphemeralMessages("agent-a", "thread-b")).toBe(false);
    expect(
      (core as unknown as { _ephemeralMessages: Map<unknown, unknown> })
        ._ephemeralMessages.size,
    ).toBe(1);
  });

  it("drops an ephemeral entry when its persisted ID arrives later", () => {
    const agent = new MockStepwiseAgent();
    agent.threadId = "thread-a";
    const core = new CopilotKitCoreReact({
      agents__unsafe_dev_only: { default: agent },
    });

    expect(
      core.addEphemeralMessage("default", "thread-a", {
        id: "later-persisted",
        content: "client-only first",
      }),
    ).toBe(true);
    agent.addMessage({
      id: "later-persisted",
      role: "user",
      content: "persisted owns this ID",
    });

    expect(core.getEphemeralMessages("default", "thread-a")).toEqual([]);
    expect(agent.messages).toEqual([
      {
        id: "later-persisted",
        role: "user",
        content: "persisted owns this ID",
      },
    ]);
    expect(
      (core as unknown as { _ephemeralMessages: Map<unknown, unknown> })
        ._ephemeralMessages.size,
    ).toBe(0);
  });

  it("notifies subscribers with the scoped immutable snapshot", async () => {
    const core = new CopilotKitCoreReact({});
    const onEphemeralMessagesChanged = vi.fn();
    const subscription = core.subscribe({ onEphemeralMessagesChanged });

    core.addEphemeralMessage("default", "thread-a", {
      id: "event",
      content: "visible",
    });
    await vi.waitFor(() =>
      expect(onEphemeralMessagesChanged).toHaveBeenCalled(),
    );

    expect(onEphemeralMessagesChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agentId: "default",
        threadId: "thread-a",
        messages: [{ id: "event", content: "visible" }],
      }),
    );
    subscription.unsubscribe();
  });

  it("starts empty when the provider-owned core is remounted", () => {
    const firstProvider = new CopilotKitCoreReact({});
    firstProvider.addEphemeralMessage("default", "thread-a", {
      id: "event",
      content: "only in the first provider",
    });

    const remountedProvider = new CopilotKitCoreReact({});
    expect(
      remountedProvider.getEphemeralMessages("default", "thread-a"),
    ).toEqual([]);
  });
});
