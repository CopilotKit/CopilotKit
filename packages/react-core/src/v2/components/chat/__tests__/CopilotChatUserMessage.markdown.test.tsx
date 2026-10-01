import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import type { UserMessage } from "@ag-ui/core";
import { CopilotChatUserMessage } from "../CopilotChatUserMessage";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";

const wrap = (node: React.ReactNode) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="user-markdown">
      {node}
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

const message = (content: string): UserMessage => ({
  id: "user-1",
  role: "user",
  content,
});

describe("CopilotChatUserMessage markdown", () => {
  it("renders code, lists and emphasis, but keeps # lines and HTML literal", async () => {
    const { container } = render(
      wrap(
        <CopilotChatUserMessage
          message={message(
            "# Not a heading\n\nUse `map` on **users**:\n\n- one\n- two\n\n<div>raw</div>\n\n```js\nusers.map(u => u.name)\n```",
          )}
        />,
      ),
    );

    expect(container.querySelector("h1")).toBeNull();
    expect(screen.getByText("# Not a heading")).toBeDefined();
    expect(
      container.querySelector('[data-streamdown="inline-code"]')?.textContent,
    ).toBe("map");
    expect(
      container.querySelector('[data-streamdown="strong"]')?.textContent,
    ).toBe("users");
    expect(
      container.querySelectorAll('[data-streamdown="list-item"]'),
    ).toHaveLength(2);
    expect(screen.getByText("<div>raw</div>")).toBeDefined();
    // Code blocks load lazily.
    await waitFor(
      () =>
        expect(
          container.querySelector('[data-streamdown="code-block"]'),
        ).not.toBeNull(),
      { timeout: 15000 },
    );
  });

  it("shows HTML as typed wherever it appears", () => {
    const { container } = render(
      wrap(
        <CopilotChatUserMessage
          message={message(
            "Wrap it in <b>bold</b>, see <https://copilotkit.ai>\n\n`<i>x</i>``\n\n````\n```\n````\n<u>after</u>\n\n    <s>indented</s>",
          )}
        />,
      ),
    );

    const text = container.textContent ?? "";
    expect(container.querySelector("b, i, u, s")).toBeNull();
    expect(text).not.toContain("&lt;");
    expect(text).toContain("Wrap it in <b>bold</b>");
    // Autolinks still link.
    expect(container.querySelector("a")?.getAttribute("href")).toMatch(
      /^https:\/\/copilotkit\.ai\/?$/,
    );
    // Unequal backtick runs are not a code span.
    expect(text).toContain("`<i>x</i>``");
    // A shorter fence inside a longer one doesn't close it.
    expect(text).toContain("<u>after</u>");
    expect(text).toContain("<s>indented</s>");
  });

  it("updates when the content changes to text of the same length", () => {
    const { rerender } = render(
      wrap(<CopilotChatUserMessage message={message("Test original")} />),
    );
    rerender(
      wrap(<CopilotChatUserMessage message={message("Test override")} />),
    );
    expect(screen.getByText("Test override")).toBeDefined();
  });

  it("shows the plain text as typed with markdown={false}", () => {
    const { container } = render(
      wrap(
        <CopilotChatUserMessage
          markdown={false}
          message={message("1. First step\n**bold**  spaced")}
        />,
      ),
    );

    expect(container.querySelector("[data-streamdown]")).toBeNull();
    expect(
      screen.getByText("1. First step **bold** spaced", {
        normalizer: (text) => text.replace(/\s+/g, " "),
      }),
    ).toBeDefined();
  });
});
