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

  it("preserves the original anchor across updates and keeps unanchored entries unanchored", () => {
    const anchoredAgent = new MockStepwiseAgent();
    anchoredAgent.threadId = "thread-a";
    anchoredAgent.addMessage({
      id: "first-persisted",
      role: "user",
      content: "first",
    });
    const unanchoredAgent = new MockStepwiseAgent();
    unanchoredAgent.threadId = "thread-b";
    const core = new CopilotKitCoreReact({
      agents__unsafe_dev_only: {
        anchored: anchoredAgent,
        unanchored: unanchoredAgent,
      },
    });

    expect(
      core.addEphemeralMessage("anchored", "thread-a", {
        id: "anchored-card",
        content: "before later history",
      }),
    ).toBe(true);
    anchoredAgent.addMessage({
      id: "later-persisted",
      role: "user",
      content: "later",
    });
    expect(
      core.addEphemeralMessage("anchored", "thread-a", {
        id: "anchored-card",
        content: "updated after later history",
      }),
    ).toBe(true);
    expect(core.getEphemeralMessages("anchored", "thread-a")).toEqual([
      {
        id: "anchored-card",
        content: "updated after later history",
        anchorMessageId: "first-persisted",
      },
    ]);

    expect(
      core.addEphemeralMessage("unanchored", "thread-b", {
        id: "unanchored-card",
        content: "without history",
      }),
    ).toBe(true);
    unanchoredAgent.addMessage({
      id: "first-persisted-in-thread-b",
      role: "user",
      content: "arrived later",
    });
    expect(
      core.addEphemeralMessage("unanchored", "thread-b", {
        id: "unanchored-card",
        content: "still without an anchor",
      }),
    ).toBe(true);
    expect(core.getEphemeralMessages("unanchored", "thread-b")).toEqual([
      { id: "unanchored-card", content: "still without an anchor" },
    ]);
  });

  it("checks persisted collisions and automatic anchors only in the requested thread", () => {
    const agent = new MockStepwiseAgent();
    agent.threadId = "thread-b";
    agent.addMessage({
      id: "thread-b-persisted",
      role: "user",
      content: "only in thread b",
    });
    const core = new CopilotKitCoreReact({
      agents__unsafe_dev_only: { default: agent },
    });

    expect(
      core.addEphemeralMessage("default", "thread-a", {
        id: "thread-b-persisted",
        content: "allowed in thread a",
      }),
    ).toBe(true);
    expect(core.getEphemeralMessages("default", "thread-a")).toEqual([
      { id: "thread-b-persisted", content: "allowed in thread a" },
    ]);
    expect(
      core.addEphemeralMessage("default", "thread-b", {
        id: "thread-b-persisted",
        content: "collision in thread b",
      }),
    ).toBe(false);
    expect(
      core.addEphemeralMessage("default", "thread-b", {
        id: "thread-b-card",
        content: "anchored in thread b",
      }),
    ).toBe(true);
    expect(core.getEphemeralMessages("default", "thread-b")).toEqual([
      {
        id: "thread-b-card",
        content: "anchored in thread b",
        anchorMessageId: "thread-b-persisted",
      },
    ]);
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
