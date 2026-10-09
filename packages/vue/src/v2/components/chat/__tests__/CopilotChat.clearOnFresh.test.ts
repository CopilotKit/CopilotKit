import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
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
  it.each(["clearReplayCursor", "clearReconnectCursor"] as const)(
    "clears state and the captured %s cursor on a fresh selection",
    async (method) => {
      const agent = new StateCapturingAgent();
      const cursors = new Map<string, string>();
      Object.defineProperty(agent, method, {
        value: (threadId: string) => cursors.delete(threadId),
      });
      const threadId = ref("saved");
      const explicit = ref(true);
      const wrapper = mount(CopilotKitProvider, {
        props: { agents__unsafe_dev_only: { default: agent } },
        slots: {
          default: () =>
            h(
              CopilotChatConfigurationProvider,
              { threadId: threadId.value, hasExplicitThreadId: explicit.value },
              { default: () => h(CopilotChat, { welcomeScreen: false }) },
            ),
        },
      });
      await flushPromises();
      agent.setState({ saved: true });
      agent.pendingInterrupts = [{ id: "approval-A", reason: "confirmation" }];
      cursors.set("saved", "last-event");
      cursors.set("other", "keep-other");
      threadId.value = "fresh";
      explicit.value = false;
      await flushPromises();
      expect(agent.state).toEqual({});
      expect(agent.pendingInterrupts).toEqual([]);
      expect(cursors.get("saved")).toBeUndefined();
      expect(cursors.get("other")).toBe("keep-other");
      wrapper.unmount();
    },
  );
  it.each(["fresh", "saved", "other", "via-fresh", "swap"])(
    "protects %s from an abandoned connect that completes later",
    async (destination) => {
      let releaseDetach = () => {};
      let releaseConnect = () => {};
      let pendingDetach: Promise<void> | undefined;
      const oldConnect = new Promise<void>((resolve) => {
        releaseConnect = resolve;
      });
      const cursors = new Map<string, string>();
      const requests: (string | null)[] = [];
      class ReplayAgent extends StateCapturingAgent {
        clearReplayCursor(threadId: string) {
          cursors.delete(threadId);
        }
        async detachActiveRun() {
          await pendingDetach;
          await super.detachActiveRun();
        }
        async connectAgent(
          ...args: Parameters<StateCapturingAgent["connectAgent"]>
        ) {
          requests.push(cursors.get(this.threadId) ?? null);
          const first = requests.length === 1;
          const result = await super.connectAgent(...args);
          if (first) await oldConnect;
          return result;
        }
      }
      const agent = new ReplayAgent();
      let currentAgent = agent;
      const threadId = ref("saved");
      const explicit = ref(true);
      const wrapper = mount(CopilotKitProvider, {
        props: { agents__unsafe_dev_only: { default: agent } },
        slots: {
          default: () =>
            h(
              CopilotChatConfigurationProvider,
              { threadId: threadId.value, hasExplicitThreadId: explicit.value },
              { default: () => h(CopilotChat, { welcomeScreen: false }) },
            ),
        },
      });
      await flushPromises();
      expect(requests).toEqual([null]);
      pendingDetach = new Promise<void>((resolve) => {
        releaseDetach = resolve;
      });
      cursors.set("saved", "old-event");
      threadId.value = "fresh";
      explicit.value = false;
      await nextTick();
      if (destination === "via-fresh") {
        threadId.value = "fresh-again";
        await nextTick();
      }
      if (destination === "swap") {
        currentAgent = new ReplayAgent();
        await wrapper.setProps({
          agents__unsafe_dev_only: { default: currentAgent },
        });
      }
      const target =
        destination === "via-fresh" || destination === "swap"
          ? "saved"
          : destination;
      if (target !== "fresh") {
        threadId.value = target;
        explicit.value = true;
        await nextTick();
      }
      expect(requests).toEqual([null]);
      cursors.set("saved", "late-event");
      releaseDetach();
      await flushPromises();
      expect(requests).toEqual(target === "fresh" ? [null] : [null, null]);
      currentAgent.setState({ current: true });
      currentAgent.pendingInterrupts = [
        { id: "approval-new", reason: "confirmation" },
      ];
      cursors.set(target, "new-event");
      releaseConnect();
      await flushPromises();
      expect(currentAgent.state).toEqual({ current: true });
      expect(currentAgent.pendingInterrupts).toEqual([
        { id: "approval-new", reason: "confirmation" },
      ]);
      expect(cursors.get(target)).toBe("new-event");
      wrapper.unmount();
    },
  );
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

    newAgent!.setMessages([{ id: "m1", role: "user", content: "hi" }]);
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
