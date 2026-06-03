import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StreamingMarkdownDefaultRenderer } from "../StreamingMarkdownDefaultRenderer";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";

describe("StreamingMarkdownDefaultRenderer config props", () => {
  it("lets a config nodeRenderers override the built-in codeBlock", () => {
    const { container } = render(
      <StreamingMarkdownDefaultRenderer
        content={"```\nx\n```"}
        nodeRenderers={{
          codeBlock: ({ node }) => <pre data-testid="custom-code">{node.text}</pre>,
        }}
      />,
    );
    expect(container.querySelector('[data-testid="custom-code"]')).not.toBeNull();
  });

  it("keeps the built-in codeBlock when no config nodeRenderers are given", () => {
    const { container } = render(
      <StreamingMarkdownDefaultRenderer content={"```\nx\n```"} />,
    );
    expect(container.querySelector('[data-testid="custom-code"]')).toBeNull();
    expect(container.querySelector("pre code")).not.toBeNull();
  });
});

const codeMsg = { id: "m1", role: "assistant", content: "```\nx\n```" } as any;

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      {children}
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

describe("markdownRenderer provider resolution", () => {
  it("provider config object configures the built-in default", () => {
    const { container } = render(
      <CopilotKitProvider
        markdownRenderer={{
          nodeRenderers: {
            codeBlock: ({ node }) => <pre data-testid="prov-code">{node.text}</pre>,
          },
        }}
      >
        <CopilotChatConfigurationProvider threadId="test-thread">
          <CopilotChatAssistantMessage message={codeMsg} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );
    expect(container.querySelector('[data-testid="prov-code"]')).not.toBeNull();
  });

  it("provider component replaces the renderer entirely (escape hatch)", () => {
    const Custom = ({ content }: { content: string }) => (
      <div data-testid="custom-renderer">{content}</div>
    );
    const { container } = render(
      <CopilotKitProvider markdownRenderer={Custom}>
        <CopilotChatConfigurationProvider threadId="test-thread">
          <CopilotChatAssistantMessage message={codeMsg} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );
    expect(container.querySelector('[data-testid="custom-renderer"]')).not.toBeNull();
  });
});
