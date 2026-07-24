import React from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => {
  const ReactRuntime = require("react");
  return {
    Platform: { OS: "web" },
    StyleSheet: {
      create: <T extends Record<string, unknown>>(styles: T): T => styles,
    },
    View: ({ children, style }: any) =>
      ReactRuntime.createElement(
        "div",
        {
          style: Object.assign(
            {},
            ...(Array.isArray(style) ? style : [style]).filter(Boolean),
          ),
        },
        children,
      ),
    Text: ({ children, style }: any) =>
      ReactRuntime.createElement(
        "span",
        {
          style: Object.assign(
            {},
            ...(Array.isArray(style) ? style : [style]).filter(Boolean),
          ),
        },
        children,
      ),
  };
});

import { UserMessage } from "../UserMessage";

describe("UserMessage on React Native Web", () => {
  it("renders markdown through the real web renderer", async () => {
    const { container } = render(
      <UserMessage
        content={[
          "Hello **web** — [docs](https://example.com)",
          "",
          "> quoted text",
          "",
          "| Key | Value |",
          "| --- | --- |",
          "| A | B |",
        ].join("\n")}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("strong")?.textContent).toBe("web");
    });
    expect(container.querySelector("a")?.textContent).toBe("docs");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com",
    );
    expect(container.querySelector("blockquote")?.style.backgroundColor).toBe(
      "rgb(0, 76, 153)",
    );
    expect(container.querySelector("table")?.style.color).toBe(
      "rgb(255, 255, 255)",
    );
  });
});
