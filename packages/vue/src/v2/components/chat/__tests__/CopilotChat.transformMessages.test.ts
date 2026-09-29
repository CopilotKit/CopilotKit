import { h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { Message } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import { StateCapturingAgent } from "../../../__tests__/utils/agents";
import CopilotChat from "../CopilotChat.vue";
import CopilotSidebar from "../CopilotSidebar.vue";
import CopilotPopup from "../CopilotPopup.vue";

// Filters out a message named "math_expert", as a langgraph-supervisor
// worker message would be (#1959).
const hideWorker = (list: Message[]) =>
  list.filter((m) => (m as { name?: string }).name !== "math_expert");

const transcript = [
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

async function mountWith(component: unknown, props: Record<string, unknown>) {
  const agent = new StateCapturingAgent();
  const wrapper = mount(CopilotKitProvider, {
    props: { agents__unsafe_dev_only: { default: agent } },
    slots: {
      default: () =>
        h(component as never, { transformMessages: hideWorker, ...props }),
    },
  });
  await flushPromises();
  agent.setMessages(transcript);
  await flushPromises();
  return wrapper;
}

describe("Vue transformMessages plumbing", () => {
  it.each([
    ["CopilotChat", CopilotChat, { welcomeScreen: false }],
    [
      "CopilotSidebar",
      CopilotSidebar,
      { defaultOpen: true, welcomeScreen: false },
    ],
    ["CopilotPopup", CopilotPopup, { defaultOpen: true, welcomeScreen: false }],
  ])(
    "%s passes transformMessages to the message view",
    async (_name, component, props) => {
      const wrapper = await mountWith(component, props);
      expect(wrapper.text()).toContain("SUPERVISOR_SAYS_FOUR");
      expect(wrapper.text()).not.toContain("WORKER_SAYS_FOUR");
    },
  );

  it("hides a message when setMessages adds only its name", async () => {
    const agent = new StateCapturingAgent();
    const wrapper = mount(CopilotKitProvider, {
      props: { agents__unsafe_dev_only: { default: agent } },
      slots: {
        default: () =>
          h(CopilotChat, {
            welcomeScreen: false,
            transformMessages: hideWorker,
          }),
      },
    });
    await flushPromises();
    agent.setMessages(
      transcript.map((m) =>
        m.id === "w-1" ? { ...m, name: undefined } : m,
      ) as Message[],
    );
    await flushPromises();
    expect(wrapper.text()).toContain("WORKER_SAYS_FOUR");

    agent.setMessages(transcript);
    await flushPromises();
    expect(wrapper.text()).not.toContain("WORKER_SAYS_FOUR");
  });
});
