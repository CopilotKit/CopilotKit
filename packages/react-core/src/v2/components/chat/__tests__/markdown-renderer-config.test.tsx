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
          codeBlock: ({ node }) => (
            <pre data-testid="custom-code">{node.text}</pre>
          ),
        }}
      />,
    );
    expect(
      container.querySelector('[data-testid="custom-code"]'),
    ).not.toBeNull();
  });

  it("merges config nodeRenderers over the built-in (non-codeBlock override keeps the default codeBlock)", () => {
    const { container } = render(
      <StreamingMarkdownDefaultRenderer
        content={"hello\n\n```\nx\n```"}
        nodeRenderers={{
          paragraph: ({ children }) => (
            <p data-testid="custom-para">{children}</p>
          ),
        }}
      />,
    );
    // custom paragraph renderer applied
    expect(
      container.querySelector('[data-testid="custom-para"]'),
    ).not.toBeNull();
    // built-in codeBlock default still present (was NOT replaced)
    expect(container.querySelector("pre code")).not.toBeNull();
  });

  it("keeps the built-in codeBlock when no config nodeRenderers are given", () => {
    const { container } = render(
      <StreamingMarkdownDefaultRenderer content={"```\nx\n```"} />,
    );
    expect(container.querySelector('[data-testid="custom-code"]')).toBeNull();
    expect(container.querySelector("pre code")).not.toBeNull();
  });

  it("survives an empty->non-empty content transition (Rules of Hooks)", () => {
    // A streaming message renders empty first, then non-empty. The early
    // `if (!content) return null` must not change the hook count between
    // renders, so the useMemo has to run unconditionally above it. Before that
    // fix, this rerender threw "Rendered more hooks than during the previous
    // render". Render empty, then rerender with content — must not throw.
    const { container, rerender } = render(
      <StreamingMarkdownDefaultRenderer content="" />,
    );
    expect(container.querySelector("p")).toBeNull();
    rerender(<StreamingMarkdownDefaultRenderer content="hello" />);
    expect(container.textContent).toContain("hello");
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
            codeBlock: ({ node }) => (
              <pre data-testid="prov-code">{node.text}</pre>
            ),
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
    expect(
      container.querySelector('[data-testid="custom-renderer"]'),
    ).not.toBeNull();
  });

  it("per-message slot config wins over a provider config (slot -> provider order)", () => {
    const { container } = render(
      <CopilotKitProvider
        markdownRenderer={{
          nodeRenderers: {
            codeBlock: ({ node }) => (
              <pre data-testid="prov-code">{node.text}</pre>
            ),
          },
        }}
      >
        <CopilotChatConfigurationProvider threadId="test-thread">
          <CopilotChatAssistantMessage
            message={codeMsg}
            markdownRenderer={{
              nodeRenderers: {
                codeBlock: ({ node }) => (
                  <pre data-testid="slot-code">{node.text}</pre>
                ),
              },
            }}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );
    // per-message slot wins; provider's codeBlock must not be used
    expect(container.querySelector('[data-testid="slot-code"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="prov-code"]')).toBeNull();
  });

  it("does not remount the markdown subtree when an inline provider config keeps the same shape", () => {
    const msg = { id: "m2", role: "assistant", content: "hello" } as any;
    const App = ({ caret }: { caret: boolean }) => (
      // fresh object literal each render — must be shallow-stabilized so the
      // resolved renderer identity is stable and the subtree is not remounted
      <CopilotKitProvider markdownRenderer={{ caret }}>
        <CopilotChatConfigurationProvider threadId="test-thread">
          <CopilotChatAssistantMessage message={msg} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );
    const { container, rerender } = render(<App caret={true} />);
    const first = container.querySelector("p");
    expect(first).not.toBeNull();
    rerender(<App caret={true} />);
    const second = container.querySelector("p");
    // same DOM node instance => the subtree was reused, not remounted
    expect(second).toBe(first);
  });
});
