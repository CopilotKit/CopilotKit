import { describe, expect, it } from "vitest";
import type { Component } from "vue";
import CopilotChat from "../CopilotChat.vue";
import CopilotChatView from "../CopilotChatView.vue";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";
import CopilotPopup from "../CopilotPopup.vue";
import CopilotPopupView from "../CopilotPopupView.vue";
import CopilotSidebar from "../CopilotSidebar.vue";
import CopilotSidebarView from "../CopilotSidebarView.vue";

type WithProps = { props?: Record<string, { default?: unknown }> };

// Vue turns a missing boolean prop into `false`, so each component that
// declares `messageFeedback` must default it to `true`, or it would turn
// reply ratings off for every chat built on it.
describe("messageFeedback defaults", () => {
  it.each([
    ["CopilotChat", CopilotChat],
    ["CopilotChatView", CopilotChatView],
    ["CopilotChatMessageView", CopilotChatMessageView],
    ["CopilotPopup", CopilotPopup],
    ["CopilotPopupView", CopilotPopupView],
    ["CopilotSidebar", CopilotSidebar],
    ["CopilotSidebarView", CopilotSidebarView],
  ] as [string, Component][])(
    "%s defaults messageFeedback to true",
    (_, component) => {
      const props = (component as WithProps).props;
      expect(props?.messageFeedback).toBeDefined();
      expect(props?.messageFeedback?.default).toBe(true);
    },
  );
});
