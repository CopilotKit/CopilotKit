import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  emitInspectorStopViewing,
  emitInspectorViewThread,
  emitInspectorViewThreadResult,
} from "@copilotkit/core";
import CopilotChatConfigurationProvider from "../CopilotChatConfigurationProvider.vue";
import { useCopilotChatConfiguration } from "../useCopilotChatConfiguration";

function harness(providerProps: Record<string, unknown>) {
  let cfg!: ReturnType<typeof useCopilotChatConfiguration>;
  const Probe = defineComponent({
    setup() {
      cfg = useCopilotChatConfiguration();
      return () => h("div", cfg.value?.threadId ?? "none");
    },
  });
  mount(CopilotChatConfigurationProvider, {
    props: providerProps,
    slots: { default: () => h(Probe) },
  });
  return () => cfg.value!;
}

describe("inspector thread override (vue)", () => {
  afterEach(() => {
    emitInspectorStopViewing({ agentId: "default" });
  });

  it("switches a pinned threadId when view-thread matches the agent", async () => {
    const cfg = harness({ agentId: "default", threadId: "pinned-thread" });
    emitInspectorViewThread({ threadId: "saved-thread", agentId: "default" });
    await nextTick();
    expect(cfg().threadId).toBe("saved-thread");
    expect(cfg().hasExplicitThreadId).toBe(true);
  });

  it("ignores view-thread for a different agent", async () => {
    const cfg = harness({ agentId: "default", threadId: "pinned-thread" });
    emitInspectorViewThread({
      threadId: "other-thread",
      agentId: "other-agent",
    });
    await nextTick();
    expect(cfg().threadId).toBe("pinned-thread");
  });

  it("restores the previous thread on stop-viewing", async () => {
    const cfg = harness({ agentId: "default", threadId: "pinned-thread" });
    emitInspectorViewThread({ threadId: "saved-thread", agentId: "default" });
    await nextTick();
    emitInspectorStopViewing({ agentId: "default" });
    await nextTick();
    expect(cfg().threadId).toBe("pinned-thread");
  });

  it("rolls back when connect fails", async () => {
    const cfg = harness({ agentId: "default", threadId: "pinned-thread" });
    emitInspectorViewThread({ threadId: "saved-thread", agentId: "default" });
    await nextTick();
    emitInspectorViewThreadResult({
      threadId: "saved-thread",
      agentId: "default",
      ok: false,
      reason: "connect-failed",
    });
    await nextTick();
    expect(cfg().threadId).toBe("pinned-thread");
  });

  it("ends the override when the app picks a thread", async () => {
    const cfg = harness({ agentId: "default" });
    emitInspectorViewThread({ threadId: "saved-thread", agentId: "default" });
    await nextTick();
    cfg().setActiveThreadId("app-picked");
    await nextTick();
    expect(cfg().threadId).toBe("app-picked");
  });
});
