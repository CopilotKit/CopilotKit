import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CopilotChatReasoningMessage } from "../CopilotChatReasoningMessage";

describe("CopilotChatReasoningMessage markdown", () => {
  it("renders reasoning content as markdown (streaming renderer)", () => {
    render(
      <CopilotChatReasoningMessage.Content hasContent>
        {"**thinking**"}
      </CopilotChatReasoningMessage.Content>,
    );
    // The streaming renderer renders bold inside <strong>; check textContent
    // rather than asserting a specific tag (the streaming renderer may wrap
    // segments in <span>s within the <strong>).
    const el = screen.getByText("thinking");
    const strongAncestor =
      el.closest("strong") ?? el.tagName.toLowerCase() === "strong"
        ? el
        : null;
    expect(strongAncestor).not.toBeNull();
  });
});
