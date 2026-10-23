import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";

import { ChatContextProvider } from "../ChatContext";
import { AssistantMessage } from "./AssistantMessage";
import { UserMessage } from "./UserMessage";

const timestamp = Date.UTC(2026, 0, 2, 3, 4);
const imageRenderer = () => null;

function renderWithTimestamps(children: ReactNode) {
  return renderToStaticMarkup(
    React.createElement(
      ChatContextProvider,
      { open: true, setOpen: () => {}, showTimestamps: true },
      children,
    ),
  );
}

describe("message timestamps", () => {
  it("renders a user message timestamp when enabled", () => {
    const markup = renderWithTimestamps(
      React.createElement(UserMessage, {
        message: { id: "user-1", role: "user", content: "Hello", timestamp },
        ImageRenderer: imageRenderer,
        rawData: undefined,
      }),
    );

    expect(markup).toMatch(
      new RegExp(`date[Tt]ime="${new Date(timestamp).toISOString()}"`),
    );
  });

  it("renders an assistant message timestamp when enabled", () => {
    const markup = renderWithTimestamps(
      React.createElement(AssistantMessage, {
        message: {
          id: "assistant-1",
          role: "assistant",
          content: "Hi",
          timestamp,
        },
        isLoading: false,
        isGenerating: false,
        ImageRenderer: imageRenderer,
        rawData: undefined,
      }),
    );

    expect(markup).toMatch(
      new RegExp(`date[Tt]ime="${new Date(timestamp).toISOString()}"`),
    );
  });

  it("does not render timestamps by default", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        ChatContextProvider,
        { open: true, setOpen: () => {} },
        React.createElement(UserMessage, {
          message: { id: "user-1", role: "user", content: "Hello", timestamp },
          ImageRenderer: imageRenderer,
          rawData: undefined,
        }),
      ),
    );

    expect(markup).not.toContain("copilot-message-timestamp");
  });
});
