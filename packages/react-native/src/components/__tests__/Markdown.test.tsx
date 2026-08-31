import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock react-native since we're in jsdom
vi.mock("react-native", () => ({
  StyleSheet: {
    create: <T extends Record<string, any>>(styles: T): T => styles,
    flatten: (style: any) => style,
  },
  View: "View",
  Text: "Text",
}));

// Capture the props passed to StreamdownText
let lastStreamdownProps: any = null;

vi.mock("react-native-streamdown", () => ({
  StreamdownText: function MockStreamdownText(props: any) {
    lastStreamdownProps = props;
    return React.createElement(
      "div",
      { "data-testid": "markdown" },
      props.markdown,
    );
  },
}));

// Import after mocks
import { CopilotMarkdown, defaultMarkdownStyles } from "../Markdown";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CopilotMarkdown", () => {
  beforeEach(() => {
    lastStreamdownProps = null;
  });

  it("renders without crashing", () => {
    const { container } = render(<CopilotMarkdown content="Hello world" />);
    expect(container).toBeTruthy();
  });

  it("passes content as markdown prop to StreamdownText", () => {
    render(<CopilotMarkdown content="# Title" />);
    expect(lastStreamdownProps).not.toBeNull();
    expect(lastStreamdownProps.markdown).toBe("# Title");
  });

  it("uses default styles when no custom style is provided", () => {
    render(<CopilotMarkdown content="test" />);
    expect(lastStreamdownProps.markdownStyle).toBe(defaultMarkdownStyles);
  });

  it("merges custom styles with defaults", () => {
    const customStyle = { paragraph: { fontSize: 20, color: "#000" } };
    render(<CopilotMarkdown content="test" style={customStyle} />);

    // Custom should override the paragraph style
    expect(lastStreamdownProps.markdownStyle.paragraph).toEqual({
      fontSize: 20,
      color: "#000",
    });
    // Other defaults should still be present
    expect(lastStreamdownProps.markdownStyle.h1).toEqual(
      defaultMarkdownStyles.h1,
    );
    expect(lastStreamdownProps.markdownStyle.codeBlock).toEqual(
      defaultMarkdownStyles.codeBlock,
    );
  });

  it("renders safely with empty content", () => {
    const { container } = render(<CopilotMarkdown content="" />);
    expect(container).toBeTruthy();
    expect(lastStreamdownProps.markdown).toBe("");
  });

  it("enables streamingAnimation by default", () => {
    render(<CopilotMarkdown content="test" />);
    expect(lastStreamdownProps.streamingAnimation).toBe(true);
  });

  it("allows disabling streamingAnimation", () => {
    render(<CopilotMarkdown content="test" streamingAnimation={false} />);
    expect(lastStreamdownProps.streamingAnimation).toBe(false);
  });
});

describe("defaultMarkdownStyles", () => {
  it("exports a style object with expected keys", () => {
    expect(defaultMarkdownStyles.paragraph).toBeDefined();
    expect(defaultMarkdownStyles.h1).toBeDefined();
    expect(defaultMarkdownStyles.h2).toBeDefined();
    expect(defaultMarkdownStyles.h3).toBeDefined();
    expect(defaultMarkdownStyles.strong).toBeDefined();
    expect(defaultMarkdownStyles.em).toBeDefined();
    expect(defaultMarkdownStyles.link).toBeDefined();
    expect(defaultMarkdownStyles.blockquote).toBeDefined();
    expect(defaultMarkdownStyles.code).toBeDefined();
    expect(defaultMarkdownStyles.codeBlock).toBeDefined();
    expect(defaultMarkdownStyles.list).toBeDefined();
  });
});
