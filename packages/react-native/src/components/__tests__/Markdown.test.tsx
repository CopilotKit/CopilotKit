import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("react-native", () => ({
  StyleSheet: {
    create: <T extends Record<string, any>>(styles: T): T => styles,
    flatten: (style: any) => style,
  },
  View: "View",
  Text: "Text",
}));

import { CopilotMarkdown, defaultMarkdownStyles } from "../Markdown";

describe("CopilotMarkdown (basic renderer)", () => {
  it("renders without crashing", () => {
    const { container } = render(<CopilotMarkdown content="Hello world" />);
    expect(container).toBeTruthy();
  });

  it("renders text content", () => {
    const { container } = render(<CopilotMarkdown content="# Title" />);
    expect(container.textContent).toContain("Title");
  });

  it("renders safely with empty content", () => {
    const { container } = render(<CopilotMarkdown content="" />);
    expect(container).toBeTruthy();
  });

  it("exports default styles with expected keys", () => {
    expect(defaultMarkdownStyles.paragraph).toBeDefined();
    expect(defaultMarkdownStyles.h1).toBeDefined();
    expect(defaultMarkdownStyles.codeBlock).toBeDefined();
  });
});
