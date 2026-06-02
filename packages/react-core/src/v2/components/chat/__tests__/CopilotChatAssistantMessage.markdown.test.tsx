import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import { MarkdownRendererProvider } from "../../../providers/MarkdownRendererContext";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";

const msg = { id: "1", role: "assistant", content: "# Hi" } as any;

const TEST_THREAD_ID = "test-thread";

const wrap = (ui: React.ReactElement) =>
  render(
    <CopilotKitProvider>
      <CopilotChatConfigurationProvider threadId={TEST_THREAD_ID}>
        {ui}
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );

const ProviderRenderer = ({ content }: { content: string }) => (
  <div data-testid="provider-renderer">{content}</div>
);

const SlotRenderer = ({ content }: { content: string }) => (
  <div data-testid="slot-renderer">{content}</div>
);

describe("CopilotChatAssistantMessage markdown resolution", () => {
  it("uses BasicMarkdownRenderer by default", () => {
    wrap(<CopilotChatAssistantMessage message={msg} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hi");
  });

  it("uses the provider renderer when set", () => {
    wrap(
      <MarkdownRendererProvider renderer={ProviderRenderer}>
        <CopilotChatAssistantMessage message={msg} />
      </MarkdownRendererProvider>,
    );
    expect(screen.getByTestId("provider-renderer")).toBeTruthy();
  });

  it("lets the slot override the provider renderer", () => {
    wrap(
      <MarkdownRendererProvider renderer={ProviderRenderer}>
        <CopilotChatAssistantMessage
          message={msg}
          markdownRenderer={SlotRenderer}
        />
      </MarkdownRendererProvider>,
    );
    expect(screen.queryByTestId("provider-renderer")).toBeNull();
    expect(screen.getByTestId("slot-renderer").textContent).toBe("# Hi");
  });

  it("default renderer renders streaming markdown content", () => {
    wrap(
      <CopilotChatAssistantMessage
        message={{ id: "s1", role: "assistant", content: "# Streaming" } as any}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Streaming");
  });
});
