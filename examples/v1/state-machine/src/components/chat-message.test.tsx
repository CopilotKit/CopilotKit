import type { AssistantMessage as AgUiAssistantMessage } from "@copilotkit/react-core/v2";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { AssistantMessage, normalizeMarkdownContent } from "./chat-message";

describe("normalizeMarkdownContent", () => {
  test.each([
    ["string", "Show me an electric car", "Show me an electric car"],
    [
      "text-part array",
      [
        { type: "text", text: "Show me" },
        {
          type: "image",
          source: { type: "data", value: "private-image-data" },
        },
        { type: "text", text: "an electric car" },
      ],
      "Show me\nan electric car",
    ],
    [
      "text-part object",
      { type: "text", text: "Show me an electric car" },
      "Show me an electric car",
    ],
    [
      "unknown content",
      { type: "image", source: { type: "data", value: "private-image-data" } },
      "Unsupported message content",
    ],
  ])("normalizes %s", (_name, content, expected) => {
    expect(normalizeMarkdownContent(content)).toBe(expected);
  });
});

function renderRunningAssistant(content: string): string {
  const message: AgUiAssistantMessage = {
    id: "assistant-message",
    role: "assistant",
    content,
  };

  return renderToStaticMarkup(
    <AssistantMessage
      message={message}
      messages={[message]}
      isRunning
      markdownRenderer={<span>{content}</span>}
      toolCallsView={null}
    />,
  );
}

describe("AssistantMessage", () => {
  test("keeps streamed text visible while the latest message is running", () => {
    const markup = renderRunningAssistant("A streamed response");

    expect(markup).toContain("A streamed response");
    expect(markup).not.toContain("animate-bounce");
  });

  test("shows loading dots while the latest message has no text", () => {
    const markup = renderRunningAssistant("");

    expect(markup.match(/animate-bounce/g)).toHaveLength(3);
  });
});
