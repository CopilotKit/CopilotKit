import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/vue";
import StreamingMarkdownDefault from "../StreamingMarkdownDefault.vue";

function renderDefault(props: Record<string, unknown>) {
  return render(StreamingMarkdownDefault, { props }).container;
}

describe("StreamingMarkdownDefault (vue)", () => {
  it("renders nothing for empty content", () => {
    expect(renderDefault({ content: "" }).innerHTML).toBe("<!--v-if-->");
  });

  it("renders fenced code with the shared code block class", () => {
    const pre = renderDefault({ content: "```ts\nx\n```" }).querySelector(
      "pre",
    );
    expect(pre?.classList.contains("cpk-markdown-code-block")).toBe(true);
    expect(pre?.querySelector("code")?.getAttribute("data-code-info")).toBe(
      "ts",
    );
  });

  it("shows the caret only while streaming", () => {
    const caret = "[data-streaming-markdown-caret]";
    expect(
      renderDefault({ content: "Hi", isStreaming: true }).querySelector(caret),
    ).not.toBeNull();
    expect(renderDefault({ content: "Hi" }).querySelector(caret)).toBeNull();
  });

  it("passes link and citation clicks to the callbacks", async () => {
    const calls: string[] = [];
    const container = renderDefault({
      content:
        "[link](https://example.com) cite [^ref]\n\n[^ref]: Ref https://example.org",
      onLinkClick: (event: MouseEvent, url: string) => {
        event.preventDefault();
        calls.push(`link:${url}`);
      },
      onCitationClick: (event: MouseEvent, citation: { id: string }) => {
        event.preventDefault();
        calls.push(`cite:${citation.id}`);
      },
    });
    await fireEvent.click(
      container.querySelector('a[href="https://example.com"]')!,
    );
    await fireEvent.click(
      container.querySelector('sup a[role="doc-noteref"]')!,
    );
    expect(calls).toEqual(["link:https://example.com", "cite:ref"]);
  });
});
