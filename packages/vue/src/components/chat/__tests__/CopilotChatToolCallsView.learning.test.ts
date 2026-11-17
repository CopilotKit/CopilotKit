import { describe, expect, it } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import type { AssistantMessage } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import type { CopilotKitLearningOptions } from "../../../providers/CopilotKitProvider.types";
import CopilotChatToolCallsView from "../CopilotChatToolCallsView.vue";

// Ported from React's CopilotChatToolCallsView.learning test.

const message: AssistantMessage = {
  id: "message-1",
  role: "assistant",
  content: "",
  toolCalls: [
    {
      id: "tool-1",
      type: "function",
      function: { name: "approve", arguments: "{}" },
    },
  ],
};
const learning: CopilotKitLearningOptions = {
  sink: () => {},
  capture: { clicks: false, navigation: false, network: false },
  autoStart: false,
};

function mountView(learningProp?: CopilotKitLearningOptions) {
  return mount(CopilotKitProvider, {
    props: {
      runtimeUrl: "/api/copilotkit",
      ...(learningProp ? { learning: learningProp } : {}),
    },
    slots: {
      default: () =>
        h(
          CopilotChatConfigurationProvider,
          { threadId: "thread-1", agentId: "default" },
          {
            default: () =>
              h("div", { "data-testid": "message" }, [
                h(
                  CopilotChatToolCallsView,
                  { message, messages: [message] },
                  { "tool-call-approve": () => h("button", "Approve") },
                ),
              ]),
          },
        ),
    },
  });
}

describe("tool call capture attributes", () => {
  it("keeps tool UI as a direct child when learning is disabled", () => {
    const wrapper = mountView();

    const button = wrapper.get("button").element;
    expect(button.parentElement?.getAttribute("data-testid")).toBe("message");
    expect(wrapper.find("[data-tool-call-id]").exists()).toBe(false);
    wrapper.unmount();
  });

  it("wraps tool UI in data-tool-call-id while learning is configured", () => {
    const wrapper = mountView(learning);

    const scope = wrapper.get("button").element.parentElement;
    expect(scope?.getAttribute("data-tool-call-id")).toBe("tool-1");
    expect((scope as HTMLElement).style.display).toBe("contents");
    expect(scope?.parentElement?.getAttribute("data-testid")).toBe("message");
    wrapper.unmount();
  });
});
