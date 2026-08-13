import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { useCopilotChatConfiguration } from "../../../providers/useCopilotChatConfiguration";
import { useCopilotKit } from "../../../providers/useCopilotKit";
import { StateCapturingAgent } from "../../../__tests__/utils/agents";
import CopilotChat from "../CopilotChat.vue";

// Proves the clear-on-fresh watch introduced in CopilotChat.vue:
//   - does NOT clear messages on initial mount
//   - DOES clear messages (setMessages([])) when the surrounding chat
//     configuration transitions to a fresh, non-explicit thread via
//     startNewThread()
describe("CopilotChat clear-on-fresh", () => {
  it("does not clear messages on initial mount", async () => {
    const agent = new StateCapturingAgent();
    // Spy before mount: attaching afterwards can never observe a mount-time
    // clear, which is exactly what this test exists to rule out.
    const setMessagesSpy = vi.spyOn(agent, "setMessages");

    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;
    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () => null;
      },
    });

    mount(CopilotKitProvider, {
      props: {
        agents__unsafe_dev_only: { default: agent },
      },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { threadId: "seed", hasExplicitThreadId: false },
            {
              default: () =>
                h("div", [h(CopilotChat, { welcomeScreen: false }), h(Probe)]),
            },
          ),
      },
    });

    await flushPromises();
    await nextTick();

    const resolvedAgent = core?.getAgent("default");
    expect(resolvedAgent).toBeDefined();
    expect(setMessagesSpy).not.toHaveBeenCalled();

    expect(setMessagesSpy).not.toHaveBeenCalled();
  });

  it("clears messages when startNewThread() drives a fresh, non-explicit switch", async () => {
    const agent = new StateCapturingAgent();

    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;
    let startNewThread: (() => void) | undefined;
    let setActiveThreadId:
      | ((threadId: string, options?: { explicit?: boolean }) => void)
      | undefined;
    let currentThreadId: string | undefined;

    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        const chatConfig = useCopilotChatConfiguration();
        core = copilotkit.value;
        startNewThread = () => chatConfig.value?.startNewThread?.();
        setActiveThreadId = (threadId, options) =>
          chatConfig.value?.setActiveThreadId?.(threadId, options);
        return () => {
          currentThreadId = chatConfig.value?.threadId;
          return null;
        };
      },
    });

    mount(CopilotKitProvider, {
      props: {
        agents__unsafe_dev_only: { default: agent },
      },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { threadId: "seed", hasExplicitThreadId: false },
            {
              default: () =>
                h("div", [h(CopilotChat, { welcomeScreen: false }), h(Probe)]),
            },
          ),
      },
    });

    await flushPromises();
    await nextTick();

    const registryAgent = core?.getAgent("default");
    const seedAgent = registryAgent;
    expect(seedAgent).toBeDefined();
    expect(currentThreadId).toBe("seed");

    expect(startNewThread).toBeDefined();
    startNewThread!();
    await flushPromises();
    await nextTick();

    expect(currentThreadId).toBeDefined();
    expect(currentThreadId).not.toBe("seed");
    const newAgentThreadId = currentThreadId!;
    const newAgent = registryAgent;
    expect(newAgent).toBeDefined();

    // The agent ends with no messages after the fresh switch. With one shared
    // instance the clear-on-fresh watch is the only thing that can empty it.
    expect(newAgent!.messages).toEqual([]);

    // Move to a third, unrelated non-explicit thread, then dirty the agent
    // directly so the next transition has something real to clear.
    expect(setActiveThreadId).toBeDefined();
    setActiveThreadId!("elsewhere", { explicit: false });
    await flushPromises();
    await nextTick();
    expect(currentThreadId).toBe("elsewhere");

    newAgent!.setMessages([{ id: "m1", role: "user", content: "hi" } as never]);
    expect(newAgent!.messages.length).toBe(1);

    // Switch back non-explicitly. Any `setMessages([])` observed here must come
    // from the clear-on-fresh watch; this fails (messages stay dirty) if the
    // watch's `currentAgent.setMessages([])` call is removed.
    setActiveThreadId!(newAgentThreadId, { explicit: false });
    await flushPromises();
    await nextTick();

    expect(currentThreadId).toBe(newAgentThreadId);
    expect(newAgent!.messages).toEqual([]);
  });
});
