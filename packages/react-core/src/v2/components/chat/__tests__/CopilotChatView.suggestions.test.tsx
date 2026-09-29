import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Suggestion } from "@copilotkit/core";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChatView } from "../CopilotChatView";

beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
});

const messages = [
  { id: "1", role: "user" as const, content: "Hello" },
  { id: "2", role: "assistant" as const, content: "Hi there!" },
];
const suggestions: Suggestion[] = [
  { title: "Plan a launch", message: "Plan a launch", isLoading: false },
];

const renderChatView = (
  props: Partial<React.ComponentProps<typeof CopilotChatView>> = {},
) =>
  render(
    <CopilotKitProvider>
      <CopilotChatConfigurationProvider threadId="suggestions">
        <CopilotChatView
          messages={messages}
          suggestions={suggestions}
          {...props}
        />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );

const suggestionsContainer = () => screen.getByTestId("copilot-suggestions");

const CustomScrollView = ({ children }: { children?: React.ReactNode }) => (
  <div data-testid="custom-scroll-view">{children}</div>
);

describe("CopilotChatView suggestions in a conversation", () => {
  it("docks them above the input in the default layout", () => {
    renderChatView();
    expect(
      screen
        .getByTestId("copilot-input-overlay")
        .contains(suggestionsContainer()),
    ).toBe(true);
    expect(
      screen
        .getByTestId("copilot-scroll-content")
        .contains(suggestionsContainer()),
    ).toBe(false);
  });

  it("keeps them inside scrollView for a children layout", () => {
    renderChatView({
      children: ({ scrollView, input }) => (
        <div>
          {scrollView}
          {input}
        </div>
      ),
    });
    expect(
      screen
        .getByTestId("copilot-scroll-content")
        .contains(suggestionsContainer()),
    ).toBe(true);
  });

  it("passes them to a custom scrollView component and doesn't dock them", () => {
    renderChatView({ scrollView: CustomScrollView });

    expect(screen.getAllByTestId("copilot-suggestions")).toHaveLength(1);
    expect(
      screen.getByTestId("custom-scroll-view").contains(suggestionsContainer()),
    ).toBe(true);
  });

  it.each([
    { name: "a className string", suggestionView: "custom-suggestions" },
    {
      name: "a className in slot props",
      suggestionView: { className: "custom-suggestions" },
    },
  ])("applies $name to the suggestion view", ({ suggestionView }) => {
    renderChatView({ suggestionView });
    expect(
      suggestionsContainer().classList.contains("custom-suggestions"),
    ).toBe(true);
  });
});
