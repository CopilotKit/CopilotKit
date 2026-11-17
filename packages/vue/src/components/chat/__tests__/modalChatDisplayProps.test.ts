import { describe, expect, it } from "vitest";
import { h } from "vue";
import type { Component } from "vue";
import { mount } from "@vue/test-utils";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import { StateCapturingAgent } from "../../../__tests__/utils/agents";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";
import CopilotPopup from "../CopilotPopup.vue";
import CopilotSidebar from "../CopilotSidebar.vue";

function mountChat(component: Component, props: Record<string, unknown>) {
  return mount(CopilotKitProvider, {
    props: { agents__unsafe_dev_only: { default: new StateCapturingAgent() } },
    slots: {
      default: () => h(component, { welcomeScreen: false, ...props }),
    },
  });
}

// The sidebar and popup draw their chat through their own views, which must
// pass the message view's display settings on.
describe.each([
  ["CopilotSidebar", CopilotSidebar],
  ["CopilotPopup", CopilotPopup],
] as [string, Component][])("%s message view settings", (_, component) => {
  it("passes toolCallDisplay and messageFeedback to the message view", () => {
    const wrapper = mountChat(component, {
      toolCallDisplay: "line",
      messageFeedback: false,
    });

    const view = wrapper.findComponent(CopilotChatMessageView);
    expect(view.props("toolCallDisplay")).toBe("line");
    expect(view.props("messageFeedback")).toBe(false);
  });

  it("keeps reply ratings on by default", () => {
    const wrapper = mountChat(component, {});

    const view = wrapper.findComponent(CopilotChatMessageView);
    expect(view.props("toolCallDisplay")).toBe("grouped");
    expect(view.props("messageFeedback")).toBe(true);
  });
});
