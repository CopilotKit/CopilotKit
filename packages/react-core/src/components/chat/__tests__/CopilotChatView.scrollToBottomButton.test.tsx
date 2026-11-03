import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CopilotChatView } from "../CopilotChatView";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";

// The scroll-to-bottom button shows only a chevron, so its accessible name
// comes from the labels config.
describe("CopilotChatView.ScrollToBottomButton", () => {
  it("is named with the default label", () => {
    render(
      <CopilotChatConfigurationProvider threadId="test-thread">
        <CopilotChatView.ScrollToBottomButton />
      </CopilotChatConfigurationProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Scroll to bottom" }),
    ).toBeDefined();
  });

  it("uses the configured label", () => {
    render(
      <CopilotChatConfigurationProvider
        threadId="test-thread"
        labels={{ chatScrollToBottomLabel: "Nach unten scrollen" }}
      >
        <CopilotChatView.ScrollToBottomButton />
      </CopilotChatConfigurationProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Nach unten scrollen" }),
    ).toBeDefined();
  });
});
