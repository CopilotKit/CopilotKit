import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/vue";
import { defineComponent, nextTick } from "vue";
import CopilotKitProvider from "../../src/v2/providers/CopilotKitProvider.vue";
import CopilotPopupView from "../../src/v2/components/chat/CopilotPopupView.vue";
import CopilotSidebarView from "../../src/v2/components/chat/CopilotSidebarView.vue";
import { observeClicks } from "../../../a11y-test-kit/src/index";
import { audit } from "../../../a11y-test-kit/src/report";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});
describe("chat accessibility baseline", () => {
  it.each([
    ["chat-popup", CopilotPopupView],
    ["chat-sidebar", CopilotSidebarView],
  ] as const)("%s", async (name, View) => {
    const stop = observeClicks();
    let clicks: ReadonlySet<Element>;
    let host: Element;
    try {
      const Host = defineComponent({
        components: { CopilotKitProvider, View },
        template:
          '<CopilotKitProvider runtime-url="/api/copilotkit"><View :default-open="true" /></CopilotKitProvider>',
      });
      const view = render(Host);
      await nextTick();
      host = view.container;
    } finally {
      clicks = stop();
    }
    expect(
      document.querySelector("[data-copilot-popup],[data-copilot-sidebar]"),
    ).not.toBeNull();
    await audit(
      "vue",
      name,
      clicks!,
      host!,
      name === "chat-popup" ? "dialog" : null,
    );
  });
});
