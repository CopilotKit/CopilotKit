import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CopilotKitProvider } from "../../src/v2/providers/CopilotKitProvider";
import { CopilotPopupView } from "../../src/v2/components/chat/CopilotPopupView";
import { CopilotSidebarView } from "../../src/v2/components/chat/CopilotSidebarView";
import { observeClicks } from "../../../a11y-test-kit/src/index";
import { audit } from "../../../a11y-test-kit/src/report";

afterEach(cleanup);
describe("chat accessibility baseline", () => {
  it.each([
    ["chat-popup", CopilotPopupView],
    ["chat-sidebar", CopilotSidebarView],
  ] as const)("%s", async (name, View) => {
    const stop = observeClicks();
    let clicks: ReadonlySet<Element>;
    let host: Element;
    try {
      const view = render(
        <CopilotKitProvider>
          <View defaultOpen />
        </CopilotKitProvider>,
      );
      host = view.container;
    } finally {
      clicks = stop();
    }
    expect(
      document.querySelector("[data-copilot-popup],[data-copilot-sidebar]"),
    ).not.toBeNull();
    await audit(
      "react",
      name,
      clicks!,
      host!,
      name === "chat-popup" ? "dialog" : null,
    );
  });
});
