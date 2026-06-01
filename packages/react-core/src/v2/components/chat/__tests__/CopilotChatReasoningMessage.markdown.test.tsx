import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CopilotChatReasoningMessage } from "../CopilotChatReasoningMessage";

describe("CopilotChatReasoningMessage markdown", () => {
  it("renders reasoning content as basic markdown (no streamdown)", () => {
    render(
      <CopilotChatReasoningMessage.Content hasContent>
        {"**thinking**"}
      </CopilotChatReasoningMessage.Content>,
    );
    expect(screen.getByText("thinking").tagName.toLowerCase()).toBe("strong");
  });
});
