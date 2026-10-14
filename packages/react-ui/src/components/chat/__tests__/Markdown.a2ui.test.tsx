import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const hoisted = vi.hoisted(() => ({ config: {} as object | null }));

vi.mock("@copilotkit/react-core/v2", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    useA2UIMarkdownConfig: () => hoisted.config,
    A2UIMarkdownSurface: ({
      fenceText,
      closed,
    }: {
      fenceText: string;
      closed: boolean;
    }) => (
      <div data-testid="a2ui-surface" data-closed={String(closed)}>
        {fenceText}
      </div>
    ),
  };
});

vi.mock("../ChatContext", () => ({
  useChatContext: () => ({ icons: {}, labels: {} }),
}));

import { Markdown } from "../Markdown";
import { AssistantMessage } from "../messages/AssistantMessage";

describe("v1 Markdown a2ui code blocks", () => {
  it("routes language-a2ui blocks to A2UIMarkdownSurface when markdown mode is on", () => {
    hoisted.config = {};
    const html = renderToStaticMarkup(
      <Markdown content={'```a2ui\n{"x":1}\n```'} />,
    );
    expect(html).toContain('data-testid="a2ui-surface"');
    expect(html).toContain("{&quot;x&quot;:1}");
    expect(html).toContain('data-closed="true"');
  });

  it("marks the fence open while the streaming cursor is present", () => {
    hoisted.config = {};
    const html = renderToStaticMarkup(
      <Markdown content={'```a2ui\n{"x":1}▍'} />,
    );
    expect(html).toContain('data-testid="a2ui-surface"');
    expect(html).toContain('data-closed="false"');
    expect(html).not.toContain("▍");
  });

  it("falls back to a plain code block in tool mode", () => {
    hoisted.config = null;
    const html = renderToStaticMarkup(
      <Markdown content={'```a2ui\n{"x":1}\n```'} />,
    );
    expect(html).not.toContain("a2ui-surface");
    expect(html).toContain("a2ui");
    expect(html).toContain("x");
  });
});

describe("v1 Markdown a2ui fence wrapper", () => {
  it("does not wrap the surface in a <pre>", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { Markdown } = await import("../Markdown");
    const html = renderToStaticMarkup(
      <Markdown content={'```a2ui\n{"x":1}\n```'} />,
    );
    expect(html).not.toContain("<pre");
  });
});

describe("v1 Markdown a2ui streaming signal", () => {
  const closedFence = '```a2ui\n{"x":1}\n```\n\nmore prose';

  it("keeps a fence open while the message is streaming", () => {
    hoisted.config = {};
    const html = renderToStaticMarkup(
      <Markdown content={closedFence} isStreaming />,
    );
    expect(html).toContain('data-closed="false"');
  });

  it("closes the fence once the message is not streaming", () => {
    hoisted.config = {};
    const html = renderToStaticMarkup(
      <Markdown content={closedFence} isStreaming={false} />,
    );
    expect(html).toContain('data-closed="true"');
  });

  it("AssistantMessage passes the streaming state of the current message", () => {
    hoisted.config = {};
    const message = { id: "m", role: "assistant", content: closedFence } as any;
    const streaming = renderToStaticMarkup(
      <AssistantMessage
        message={message}
        isLoading={false}
        isGenerating
        isCurrentMessage
      />,
    );
    expect(streaming).toContain('data-closed="false"');
    const done = renderToStaticMarkup(
      <AssistantMessage
        message={message}
        isLoading={false}
        isGenerating={false}
        isCurrentMessage
      />,
    );
    expect(done).toContain('data-closed="true"');
  });
});
