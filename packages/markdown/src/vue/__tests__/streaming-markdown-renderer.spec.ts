import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import { h } from "vue";
import { StreamingMarkdownRenderer } from "../streaming-markdown-renderer";

describe("StreamingMarkdownRenderer (Vue)", () => {
  it("renders a heading from # Hi", () => {
    const w = mount(StreamingMarkdownRenderer, {
      props: { content: "# Hi", isComplete: true },
    });
    expect(w.find("h1").text()).toContain("Hi");
  });

  it("renders bold text from **b**", () => {
    const w = mount(StreamingMarkdownRenderer, {
      props: { content: "**b**", isComplete: true },
    });
    const strong = w.find("strong");
    expect(strong.exists()).toBe(true);
    expect(strong.text()).toBe("b");
  });

  it("renders a code block with pre>code", () => {
    const w = mount(StreamingMarkdownRenderer, {
      props: { content: "```\nx\n```", isComplete: true },
    });
    expect(w.find("pre code").text()).toContain("x");
  });

  it("sanitizes javascript: href on links", () => {
    const w = mount(StreamingMarkdownRenderer, {
      props: { content: "[x](javascript:alert(1))", isComplete: true },
    });
    const a = w.find("a");
    // href should be absent or undefined — not rendered
    expect(a.attributes("href")).toBeUndefined();
  });

  it("renders nothing for empty content", () => {
    const w = mount(StreamingMarkdownRenderer, {
      props: { content: "", isComplete: true },
    });
    // no paragraphs/headings/etc
    expect(w.find("p").exists()).toBe(false);
    expect(w.find("h1").exists()).toBe(false);
  });

  it("renders heading during streaming (isComplete: false)", () => {
    const w = mount(StreamingMarkdownRenderer, {
      props: { content: "# Partial", isComplete: false },
    });
    expect(w.find("h1").text()).toContain("Partial");
  });

  it("applies camelCase nodeRenderers keys such as listItem", () => {
    const w = mount(StreamingMarkdownRenderer, {
      props: {
        content: "- item",
        isComplete: true,
        nodeRenderers: {
          listItem: () => h("li", { "data-override": "listItem" }, "over"),
        },
      },
    });
    expect(w.find("li").attributes("data-override")).toBe("listItem");
    expect(w.find("li").text()).toBe("over");
  });

  it("does not emit CopilotKit Tailwind classes on code blocks", () => {
    const w = mount(StreamingMarkdownRenderer, {
      props: { content: "```\nx\n```", isComplete: true },
    });
    expect(w.find("pre").classes().join(" ")).not.toContain("cpk:");
  });
});

describe("StreamingMarkdownRenderer (Vue) parity with React", () => {
  const citedSource =
    "[link](https://example.com) cite [^ref]\n\n[^ref]: Ref https://example.org";

  function mountComplete(content: string, extra: Record<string, unknown> = {}) {
    return mount(StreamingMarkdownRenderer, {
      props: { content, isComplete: true, ...extra },
    });
  }

  it("calls onLinkClick and onCitationClick with the sanitized target", async () => {
    const calls: string[] = [];
    const w = mountComplete(citedSource, {
      onLinkClick: (event: MouseEvent, url: string) => {
        event.preventDefault();
        calls.push(`link:${url}`);
      },
      onCitationClick: (event: MouseEvent, citation: { id: string }) => {
        event.preventDefault();
        calls.push(`cite:${citation.id}`);
      },
    });
    await w.find('a[href="https://example.com"]').trigger("click");
    await w.find('sup a[role="doc-noteref"]').trigger("click");
    expect(calls).toEqual(["link:https://example.com", "cite:ref"]);
  });

  it("links a citation to its definition URL", () => {
    const w = mountComplete(citedSource);
    expect(w.find('sup a[role="doc-noteref"]').attributes("href")).toBe(
      "https://example.org",
    );
  });

  it("renders the caret inside the open paragraph while streaming", () => {
    const w = mount(StreamingMarkdownRenderer, {
      props: { content: "Para", caret: true, options: { segmenter: false } },
    });
    expect(w.find("p [data-streaming-markdown-caret]").exists()).toBe(true);
  });

  it("renders strikethrough as <s>", () => {
    expect(mountComplete("~~gone~~").find("s").text()).toBe("gone");
  });

  it("injects the per-token fade-in stylesheet next to the root", () => {
    const w = mountComplete("hi");
    expect(w.find("style").text()).toContain(".cpk-streaming-markdown-segment");
  });
});
