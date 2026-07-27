import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { useCopilotChatConfiguration } from "../../../providers/useCopilotChatConfiguration";
import { useCopilotKit } from "../../../providers/useCopilotKit";
import { StateCapturingAgent } from "../../../__tests__/utils/agents";
import CopilotChat from "../CopilotChat.vue";
import { getThreadClone } from "../../../hooks/use-agent";

// Proves the clear-on-fresh watch introduced in CopilotChat.vue:
//   - does NOT clear messages on initial mount
//   - DOES clear messages (setMessages([])) when the surrounding chat
//     configuration transitions to a fresh, non-explicit thread via
//     startNewThread()
describe("CopilotChat clear-on-fresh", () => {
  it("does not clear messages on initial mount", async () => {
    const agent = new StateCapturingAgent();

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

    const registryAgent = core?.getAgent("default");
    const resolvedAgent = getThreadClone(registryAgent, "seed");
    expect(resolvedAgent).toBeDefined();

    // Attach the spy only after mount has settled so the clone's own
    // construction-time `setMessages([])` reset (in `cloneForThread`,
    // unrelated to the clear-on-fresh watch) isn't mistaken for a clear.
    const setMessagesSpy = vi.spyOn(resolvedAgent!, "setMessages");
    await nextTick();

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
    const seedAgent = getThreadClone(registryAgent, "seed");
    expect(seedAgent).toBeDefined();
    expect(currentThreadId).toBe("seed");

    expect(startNewThread).toBeDefined();
    startNewThread!();
    await flushPromises();
    await nextTick();

    expect(currentThreadId).toBeDefined();
    expect(currentThreadId).not.toBe("seed");
    const newAgentThreadId = currentThreadId!;
    const newAgent = getThreadClone(registryAgent, newAgentThreadId);
    expect(newAgent).toBeDefined();
    expect(newAgent).not.toBe(seedAgent);

    // Primary, behavioral assertion: the new agent ends with no messages
    // after the fresh switch (this alone doesn't distinguish the watch from
    // clone construction, since `cloneForThread` also resets to `[]`).
    expect(newAgent!.messages).toEqual([]);

    // Move to a third, unrelated non-explicit thread so `newAgent` is no
    // longer the active agent, then dirty it directly (bypassing
    // `cloneForThread`'s construction reset entirely, since the clone
    // already exists in the cache).
    expect(setActiveThreadId).toBeDefined();
    setActiveThreadId!("elsewhere", { explicit: false });
    await flushPromises();
    await nextTick();
    expect(currentThreadId).toBe("elsewhere");

    newAgent!.setMessages([{ id: "m1", role: "user", content: "hi" } as never]);
    expect(newAgent!.messages.length).toBe(1);

    // Switch back to `newAgent`'s thread id, non-explicitly. Because the
    // clone already exists in the cache, `getOrCreateThreadClone` returns it
    // without reconstructing it — so any `setMessages([])` observed here
    // must come from the clear-on-fresh watch, not from clone construction.
    // This fails (messages stay dirty) if the watch's
    // `currentAgent.setMessages([])` call is removed.
    setActiveThreadId!(newAgentThreadId, { explicit: false });
    await flushPromises();
    await nextTick();

    expect(currentThreadId).toBe(newAgentThreadId);
    expect(newAgent!.messages).toEqual([]);
  });
});
