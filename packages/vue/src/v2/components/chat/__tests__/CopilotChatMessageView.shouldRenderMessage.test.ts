import { h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { Message } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";

const hideWorker = (m: Message) =>
  (m as { name?: string }).name !== "math_expert";

const supervisorTranscript = [
  { id: "u1", role: "user", content: "what is 2+2" },
  {
    id: "w-1",
    role: "assistant",
    name: "math_expert",
    content: "WORKER_SAYS_FOUR",
  },
  {
    id: "sup-2",
    role: "assistant",
    name: "supervisor",
    content: "SUPERVISOR_SAYS_FOUR",
  },
] as Message[];

function mountView(initial: {
  messages: Message[];
  shouldRenderMessage?: (m: Message) => boolean;
  isRunning?: boolean;
}) {
  const state = ref(initial);
  const wrapper = mount(CopilotKitProvider, {
    props: { runtimeUrl: "/api/copilotkit" },
    slots: {
      default: () =>
        h(
          CopilotChatConfigurationProvider,
          { agentId: "default", threadId: "thread-srm" },
          {
            default: () => h(CopilotChatMessageView, { ...state.value }),
          },
        ),
    },
  });
  return { wrapper, state };
}

describe("Vue CopilotChatMessageView shouldRenderMessage", () => {
  it("renders every message when no predicate is given", () => {
    const { wrapper } = mountView({ messages: supervisorTranscript });
    expect(wrapper.text()).toContain("WORKER_SAYS_FOUR");
  });

  it("hides langgraph-supervisor worker messages by name (#1959)", () => {
    const { wrapper } = mountView({
      messages: supervisorTranscript,
      shouldRenderMessage: hideWorker,
    });
    expect(wrapper.text()).not.toContain("WORKER_SAYS_FOUR");
    expect(wrapper.text()).toContain("SUPERVISOR_SAYS_FOUR");
    expect(wrapper.text()).toContain("what is 2+2");
  });

  it("hides a row when a later render adds its name", async () => {
    const unnamed = supervisorTranscript.map((m) =>
      m.id === "w-1" ? { ...m, name: undefined } : m,
    ) as Message[];
    const { wrapper, state } = mountView({
      messages: unnamed,
      shouldRenderMessage: hideWorker,
    });
    expect(wrapper.text()).toContain("WORKER_SAYS_FOUR");
    state.value = {
      messages: supervisorTranscript,
      shouldRenderMessage: hideWorker,
    };
    await nextTick();
    expect(wrapper.text()).not.toContain("WORKER_SAYS_FOUR");
  });

  it("keeps the cursor while running when the last message is hidden", () => {
    const { wrapper } = mountView({
      messages: supervisorTranscript.slice(0, 2),
      isRunning: true,
      shouldRenderMessage: hideWorker,
    });
    expect(wrapper.text()).not.toContain("WORKER_SAYS_FOUR");
    expect(
      wrapper.find('[data-testid="copilot-loading-cursor"]').exists(),
    ).toBe(true);
  });

  it("renders no rows when every message is hidden", () => {
    const { wrapper } = mountView({
      messages: supervisorTranscript,
      shouldRenderMessage: () => false,
    });
    expect(wrapper.findAll("[data-message-id]").length).toBe(0);
  });
});
