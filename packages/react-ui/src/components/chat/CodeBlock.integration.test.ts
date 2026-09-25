// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock";

it("highlights JavaScript after the grammar chunk loads", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(CodeBlock, {
          language: "javascript",
          value: "const answer = 42;",
        }),
      );
    });
    await vi.waitFor(
      () => {
        expect(container.querySelector("code")?.innerHTML).toMatch(/<span/);
      },
      { timeout: 5000 },
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
