import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CopilotChatSuggestionPill } from "../../components/chat/CopilotChatSuggestionPill";

describe("CopilotStyle in the browser", () => {
  it("adds each component's styles to document.head once, with no stylesheet import", () => {
    render(
      <>
        <CopilotChatSuggestionPill>One</CopilotChatSuggestionPill>
        <CopilotChatSuggestionPill>Two</CopilotChatSuggestionPill>
      </>,
    );

    const pillStyles = document.head.querySelectorAll(
      'style[data-href="cpk-suggestion-pill"]',
    );
    const baseStyles = document.head.querySelectorAll(
      'style[data-href="cpk-base"]',
    );

    expect(pillStyles).toHaveLength(1);
    expect(baseStyles).toHaveLength(1);
    expect(pillStyles[0]!.textContent).toContain(".cpk-suggestion-pill)");
    expect(document.body.querySelectorAll("style")).toHaveLength(0);
  });
});
