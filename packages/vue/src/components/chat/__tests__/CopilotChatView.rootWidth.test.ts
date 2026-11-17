import { describe, expect, it } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import { stylesheet } from "@copilotkit/core/styles";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatView from "../CopilotChatView.vue";

const CHAT_ROOT_SELECTOR = ".copilotKitChat[data-copilotkit]";

function mountChatView(props: Record<string, unknown>) {
  return mount(CopilotKitProvider, {
    props: { runtimeUrl: "/api/copilotkit" },
    slots: {
      default: () =>
        h(
          CopilotChatConfigurationProvider,
          { threadId: "t1" },
          { default: () => h(CopilotChatView, props) },
        ),
    },
  });
}

// PE-1053, the Vue side of PE-788: the chat root is an inline-size container
// (`.cpk-chat-view`), so its content gives it no intrinsic width. As a flex
// item in a row its auto width collapsed to a narrow column. jsdom does no
// layout, so these tests pin the two halves of the fix: the zero-specificity
// width rule in the shared stylesheet, and a chat root that the rule's
// selector matches.
describe("CopilotChatView root width (PE-1053)", () => {
  it("fills its container with a :where() rule, so app widths still win", () => {
    expect(stylesheet).toContain(`:where(${CHAT_ROOT_SELECTOR}){width:100%}`);
  });

  // The welcome screen and the message view share this one root element.
  it("the chat root matches the width rule", () => {
    const wrapper = mountChatView({ messages: [] });
    const root = wrapper.find("[data-testid='copilot-chat-view']");
    expect(root.exists()).toBe(true);
    expect(root.element.matches(CHAT_ROOT_SELECTOR)).toBe(true);
  });
});
