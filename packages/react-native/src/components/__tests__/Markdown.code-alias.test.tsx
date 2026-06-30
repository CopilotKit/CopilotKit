import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("react-native", () => ({
  StyleSheet: {
    create: <T extends Record<string, any>>(styles: T): T => styles,
    flatten: (style: any) => style,
  },
  View: "View",
  Text: "Text",
}));

// Capture the props handed to the underlying streaming renderer so we can
// assert how CopilotMarkdown translates its public style map.
const capturedProps: any[] = [];
vi.mock("@copilotkit/markdown-renderer/react-native", () => ({
  StreamingMarkdownRenderer: (props: any) => {
    capturedProps.push(props);
    return null;
  },
  defaultMarkdownStyles: { inlineCode: { color: "default" } },
}));

import { CopilotMarkdown } from "../Markdown";

describe("CopilotMarkdown back-compat `code` style alias", () => {
  beforeEach(() => {
    capturedProps.length = 0;
  });

  it("maps the back-compat `code` alias onto `inlineCode` (which the renderer reads)", () => {
    render(
      <CopilotMarkdown content={"`x`"} style={{ code: { color: "red" } }} />,
    );
    // Regression: the renderer reads `inlineCode`, not `code`. Without the
    // alias translation, `style={{ code }}` silently lost inline-code styling.
    expect(capturedProps[0].style.inlineCode).toEqual({ color: "red" });
    // The alias key itself is not forwarded.
    expect(capturedProps[0].style.code).toBeUndefined();
  });

  it("lets an explicit `inlineCode` win over the `code` alias", () => {
    render(
      <CopilotMarkdown
        content={"`x`"}
        style={{ code: { color: "red" }, inlineCode: { color: "blue" } }}
      />,
    );
    expect(capturedProps[0].style.inlineCode).toEqual({ color: "blue" });
  });

  it("passes style through untouched when no `code` alias is present", () => {
    render(
      <CopilotMarkdown content={"`x`"} style={{ paragraph: { margin: 1 } }} />,
    );
    expect(capturedProps[0].style).toEqual({ paragraph: { margin: 1 } });
  });
});
