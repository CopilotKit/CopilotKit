import { describe, expect, it } from "vitest";

import { highlightMarkdownInput } from "../markdown-input-highlight";

const renderPreview = (text: string) => {
  const preview = document.createElement("div");
  preview.innerHTML = highlightMarkdownInput(text);
  return preview;
};

const drafts = [
  "plain text",
  "Can you review these?\n- migrate `useChat`\n- read the [guide](https://docs.copilotkit.ai)\n1. first\n2) second",
  "```ts\n- not a list\n```\nafter",
  "ends with a newline\n",
  "see https://copilotkit.ai, then continue",
  '<b>tags</b> & quotes "stay" text',
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

  it("styles nothing else and never parses the text as HTML", () => {
    const preview = renderPreview("**bold** _it_ `code` > quote\n# heading");
    expect(preview.querySelector("span")).toBeNull();
    expect(renderPreview(drafts[5]!).querySelector("b")).toBeNull();
  });
});
