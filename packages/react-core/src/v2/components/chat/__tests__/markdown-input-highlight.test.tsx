import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { highlightMarkdownInput } from "../markdown-input-highlight";

const renderPreview = (text: string) =>
  render(<div>{highlightMarkdownInput(text)}</div>).container
    .firstElementChild!;

const drafts = [
  "plain text",
  "Can you review these?\n- migrate `useChat`\n- read the [guide](https://docs.copilotkit.ai)\n1. first\n2) second",
  "```ts\n- not a list\n```\nafter",
  "ends with a newline\n",
  "see https://copilotkit.ai, then continue",
];

describe("highlightMarkdownInput", () => {
  it.each(drafts)("keeps every character of %j so the layers align", (text) => {
    const preview = renderPreview(text);
    expect(preview.textContent!.replace("​", "")).toBe(text);
  });

  it("styles list markers and links without dropping the syntax", () => {
    const preview = renderPreview(drafts[1]!);
    expect(preview.querySelectorAll(".cpk-md-list-marker")).toHaveLength(4);
    expect(preview.querySelector(".cpk-md-link")?.textContent).toBe("guide");
    expect(
      Array.from(
        preview.querySelectorAll(".cpk-md-syntax"),
        (node) => node.textContent,
      ),
    ).toEqual(["[", "](https://docs.copilotkit.ai)"]);
  });

  it("underlines bare URLs without trailing punctuation", () => {
    const preview = renderPreview(drafts[4]!);
    expect(preview.querySelector(".cpk-md-link")?.textContent).toBe(
      "https://copilotkit.ai",
    );
  });

  it("leaves fenced code as typed", () => {
    const preview = renderPreview(drafts[2]!);
    expect(preview.querySelector(".cpk-md-list-marker")).toBeNull();
  });
});
