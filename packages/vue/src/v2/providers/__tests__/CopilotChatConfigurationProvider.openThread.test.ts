import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { CopilotKitCore } from "@copilotkit/core";
import CopilotKitProvider from "../CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../CopilotChatConfigurationProvider.vue";

// Core links captured interactions to the Thread that a chat view shows, as
// React's CopilotChatConfigurationProvider does.

afterEach(() => {
  vi.restoreAllMocks();
});

function spyOnRegistration() {
  const registration = { update: vi.fn(), unregister: vi.fn() };
  const register = vi
    .spyOn(CopilotKitCore.prototype, "registerOpenThread")
    .mockReturnValue(registration);
  return { register, registration };
}

describe("CopilotChatConfigurationProvider open Thread", () => {
  it("registers its Thread, follows Thread changes, and unregisters on unmount", async () => {
    const { register, registration } = spyOnRegistration();
    const threadId = ref("t-1");
    const App = defineComponent({
      setup: () => () =>
        h(
          CopilotKitProvider,
          { runtimeUrl: "/api/copilotkit" },
          {
            default: () =>
              h(
                CopilotChatConfigurationProvider,
                { agentId: "agent-a", threadId: threadId.value },
                { default: () => h("div") },
              ),
          },
        ),
    });
    const wrapper = mount(App);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith({
      agentId: "agent-a",
      threadId: "t-1",
    });

    threadId.value = "t-2";
    await nextTick();
    expect(registration.update).toHaveBeenLastCalledWith("t-2");
    expect(register).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    expect(registration.unregister).toHaveBeenCalledTimes(1);
  });

  it("works without a CopilotKitProvider", () => {
    const { register } = spyOnRegistration();
    const wrapper = mount(CopilotChatConfigurationProvider, {
      props: { agentId: "agent-a", threadId: "t-1" },
      slots: { default: () => h("div") },
    });

    expect(register).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
