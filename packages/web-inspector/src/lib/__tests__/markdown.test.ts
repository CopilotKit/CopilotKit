import { describe, expect, it, vi } from "vitest";

import { renderMarkdownToHtml } from "../markdown.js";
import type { MarkdownHtmlOptions } from "../markdown.js";

/** Mirrors the Inspector's policy: only http(s)/mailto survive, tagged with a ref. */
const isSafeUrl = (url: string) => {
  try {
    const { protocol } = new URL(url, "https://inspector.test/");
    return ["http:", "https:", "mailto:"].includes(protocol);
  } catch {
    return false;
  }
};
const options: MarkdownHtmlOptions = {
  linkHref: (url) => (isSafeUrl(url) ? `${url}?ref=test` : "#"),
  imageSrc: (url) => (isSafeUrl(url) ? url : null),
  copyPayload: (code) => `payload:${code.length}`,
};

/** Render into a detached element, the way `unsafeHTML` would insert it. */
function render(
  markdown: string,
  overrides: Partial<MarkdownHtmlOptions> = {},
) {
  const host = document.createElement("div");
  host.innerHTML = renderMarkdownToHtml(markdown, { ...options, ...overrides });
  return host;
}

function childTags(element: Element): string[] {
  return Array.from(element.children, (child) => child.tagName.toLowerCase());
}

describe("renderMarkdownToHtml", () => {
  it("renders ATX and setext headings at their level", () => {
    const host = render("# One\n## Two\n### Three\n\nFour\n----");
    expect(childTags(host)).toEqual(["h1", "h2", "h3", "h2"]);
    expect(host.querySelector("h3")?.textContent).toBe("Three");
    expect(host.lastElementChild?.textContent).toBe("Four");
  });

  it("renders emphasis, strong, and strikethrough", () => {
    const host = render("*soft* **loud** ~~gone~~");
    expect(host.querySelector("p > em")?.textContent).toBe("soft");
    expect(host.querySelector("p > strong")?.textContent).toBe("loud");
    expect(host.querySelector("p > del")?.textContent).toBe("gone");
  });

  it("keeps a list tight when a blank line only ends it", () => {
    const host = render("- **one** item\n- two\n\nAfter the list.");
    expect(childTags(host)).toEqual(["ul", "p"]);
    const items = host.querySelectorAll("ul > li");
    expect(items).toHaveLength(2);
    expect(host.querySelector("li p")).toBeNull();
    expect(items[0]!.querySelector("strong")?.textContent).toBe("one");
  });

  it("wraps item paragraphs when blank lines separate items or paragraphs", () => {
    const spaced = render("- one\n\n- two");
    expect(
      Array.from(spaced.querySelectorAll("li > p"), (p) => p.textContent),
    ).toEqual(["one", "two"]);

    const multi = render("- first\n\n  second\n- third");
    const [first, second] = Array.from(multi.querySelectorAll("li"));
    expect(
      Array.from(first!.querySelectorAll("p"), (p) => p.textContent),
    ).toEqual(["first", "second"]);
    expect(second!.querySelector("p")?.textContent).toBe("third");
  });

  it("renders ordered lists with a start number only when it is not 1", () => {
    expect(
      render("1. a\n2. b").querySelector("ol")?.hasAttribute("start"),
    ).toBe(false);
    expect(
      render("3. a\n4. b").querySelector("ol")?.getAttribute("start"),
    ).toBe("3");
  });

  it("renders task list markers as disabled checkboxes", () => {
    const boxes = render(
      "- [ ] todo\n- [x] done",
    ).querySelectorAll<HTMLInputElement>("li > input[type=checkbox]");
    expect(Array.from(boxes, (box) => [box.checked, box.disabled])).toEqual([
      [false, true],
      [true, true],
    ]);
    expect(boxes[0]!.parentElement?.textContent?.trim()).toBe("todo");
  });

  it("renders fenced code escaped, with a sanitized language and a copy button", () => {
    const copyPayload = vi.fn(() => "encoded");
    const source = 'const tag = "<script>alert(1)</script>";\nnext && line';
    const host = render(`\`\`\`ts"><img title=demo\n${source}\n\`\`\``, {
      copyPayload,
    });
    const code = host.querySelector(".announcement-code pre > code");
    expect(code?.textContent).toBe(source);
    expect(code?.className).toBe("language-tsimg");
    expect(host.querySelector("script, img")).toBeNull();
    expect(copyPayload).toHaveBeenCalledWith(source);
    const button = host.querySelector(".announcement-code__copy");
    expect(button?.getAttribute("data-copy")).toBe("encoded");
    expect(button?.getAttribute("aria-label")).toBe("Copy code");
  });

  it("renders inline code as escaped text", () => {
    const code = render("Add `<copilot-chat />` & `a && b`").querySelectorAll(
      "code",
    );
    expect(Array.from(code, (node) => node.textContent)).toEqual([
      "<copilot-chat />",
      "a && b",
    ]);
    expect(render("`<b>x</b>`").querySelector("b")).toBeNull();
  });

  it("opens links in a new tab through the caller's href policy", () => {
    const link = render(
      '[Docs **now**](https://docs.test/a?b=1&c=2 "Read <docs>")',
    ).querySelector("a");
    expect(link?.getAttribute("href")).toBe(
      "https://docs.test/a?b=1&c=2?ref=test",
    );
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener");
    expect(link?.getAttribute("title")).toBe("Read <docs>");
    expect(link?.querySelector("strong")?.textContent).toBe("now");
  });

  it("routes bare URLs through the same link policy", () => {
    const link = render(
      "See https://example.test/path for more.",
    ).querySelector("a");
    expect(link?.textContent).toBe("https://example.test/path");
    expect(link?.getAttribute("href")).toBe(
      "https://example.test/path?ref=test",
    );
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("neuters unsafe link and image URLs", () => {
    const host = render(
      "[click](javascript:alert(1)) ![pic](javascript:alert(2)) ![ok](https://img.test/a.png)",
    );
    expect(host.querySelector("a")?.getAttribute("href")).toBe("#");
    const images = host.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]!.getAttribute("src")).toBe("https://img.test/a.png");
    expect(images[0]!.getAttribute("alt")).toBe("ok");
    expect(host.textContent).toContain("pic");
  });

  it("cannot break out of an attribute with a quote in the URL", () => {
    const link = render(
      '[x](https://a.test/"onmouseover="alert(1))',
    ).querySelector("a");
    expect(link?.hasAttribute("onmouseover")).toBe(false);
    expect(link?.getAttributeNames().sort()).toEqual(["href", "rel", "target"]);
  });

  it("renders raw HTML as visible text instead of markup", () => {
    const host = render(
      "<script>alert('block')</script>\n\nInline <img src=x onerror=alert(1)> and <b>bold</b>.",
    );
    expect(host.querySelector("script, img, b")).toBeNull();
    expect(host.textContent).toContain("<script>alert('block')</script>");
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("keeps character references as written but escapes bare ampersands", () => {
    expect(
      render("Fish &amp; chips &copy; 5 < 6 & 7").textContent?.trim(),
    ).toBe("Fish & chips © 5 < 6 & 7");
    expect(render("&lt;script&gt;").querySelector("script")).toBeNull();
  });

  it("renders tables with a header row and column alignment", () => {
    const table = render(
      "| Name | Count |\n|------|:----:|\n| a | 1 |",
    ).querySelector("table");
    expect(
      Array.from(table!.querySelectorAll("thead th"), (th) => th.textContent),
    ).toEqual(["Name", "Count"]);
    const cells = table!.querySelectorAll("tbody td");
    expect(Array.from(cells, (td) => td.textContent)).toEqual(["a", "1"]);
    expect(cells[1]!.getAttribute("align")).toBe("center");
  });

  it("renders blockquotes, rules, and hard breaks", () => {
    const host = render("> quoted\n\n---\n\nline one\\\nline two");
    expect(host.querySelector("blockquote > p")?.textContent).toBe("quoted");
    expect(host.querySelector("hr")).not.toBeNull();
    expect(host.querySelector("p br")).not.toBeNull();
  });

  it("renders nothing for an empty document", () => {
    expect(renderMarkdownToHtml("", options)).toBe("");
    expect(renderMarkdownToHtml("  \n \n", options)).toBe("");
  });
});
