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
    let currentThreadId: string | undefined;

    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        const chatConfig = useCopilotChatConfiguration();
        core = copilotkit.value;
        startNewThread = () => chatConfig.value?.startNewThread?.();
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

    // Spy on the shared prototype method (rather than the seed instance)
    // because the clear-on-fresh watch acts on the *newly resolved* clone
    // that is created as part of the same transition triggered by
    // `startNewThread()` — the seed clone itself is not touched.
    const setMessagesProtoSpy = vi.spyOn(
      Object.getPrototypeOf(seedAgent),
      "setMessages",
    );

    expect(startNewThread).toBeDefined();
    startNewThread!();
    await flushPromises();
    await nextTick();

    expect(currentThreadId).toBeDefined();
    expect(currentThreadId).not.toBe("seed");
    const newAgent = getThreadClone(registryAgent, currentThreadId);
    expect(newAgent).toBeDefined();
    expect(newAgent).not.toBe(seedAgent);

    // `cloneForThread` itself calls `setMessages([])` exactly once during
    // construction of the new clone (an unconditional reset, unrelated to
    // the clear-on-fresh watch). The watch fires a *second*, independent
    // `setMessages([])` call against that same resolved agent. Distinguish
    // the two via `mock.contexts` (the `this` receiver of each call).
    const callsOnNewAgent = setMessagesProtoSpy.mock.calls.filter(
      (_call, index) => setMessagesProtoSpy.mock.contexts[index] === newAgent,
    );
    const emptyCallsOnNewAgent = callsOnNewAgent.filter(
      ([messages]) => Array.isArray(messages) && messages.length === 0,
    );

    expect(emptyCallsOnNewAgent.length).toBeGreaterThanOrEqual(2);
    expect(newAgent!.messages).toEqual([]);
  });
});
