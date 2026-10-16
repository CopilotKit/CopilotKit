import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const hoisted = vi.hoisted(() => ({
  runtime: null as { transport: "tool" | "markdown" } | null,
}));

vi.mock("@copilotkit/react-core/v2/generative-ui", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    useGenerativeUIRuntime: () => hoisted.runtime,
    MarkdownSurfaces: ({
      content,
      messageId,
    }: {
      content: string;
      messageId: string;
    }) => (
      <div data-testid="markdown-surfaces" data-message={messageId}>
        {content}
      </div>
    ),
  };
});

import { Markdown } from "./Markdown";

const FENCE = '```a2ui\n{"x":1}\n```';

/**
 * The v1 chat renders a2ui fences through the generative UI markdown
 * transport when the v1 provider got a `generativeUI` prop with it.
 */
describe("v1 Markdown with the generative UI markdown transport", () => {
  it("renders the message with MarkdownSurfaces when the transport is markdown", () => {
    hoisted.runtime = { transport: "markdown" };
    const html = renderToStaticMarkup(
      <Markdown content={FENCE} messageId="m1" />,
    );
    expect(html).toContain('data-testid="markdown-surfaces"');
    expect(html).toContain('data-message="m1"');
    expect(html).not.toContain("<pre");
  });

  it("renders a plain code block with the tool transport", () => {
    hoisted.runtime = { transport: "tool" };
    const html = renderToStaticMarkup(
      <Markdown content={FENCE} messageId="m1" />,
    );
    expect(html).not.toContain("markdown-surfaces");
    expect(html).toContain("a2ui");
  });

  it("renders a plain code block without a generative UI provider", () => {
    hoisted.runtime = null;
    const html = renderToStaticMarkup(
      <Markdown content={FENCE} messageId="m1" />,
    );
    expect(html).not.toContain("markdown-surfaces");
  });

  it("needs a message id to find the fences of the message", () => {
    hoisted.runtime = { transport: "markdown" };
    const html = renderToStaticMarkup(<Markdown content={FENCE} />);
    expect(html).not.toContain("markdown-surfaces");
  });
});
