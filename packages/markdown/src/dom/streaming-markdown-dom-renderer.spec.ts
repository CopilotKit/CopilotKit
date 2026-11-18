import { afterEach, describe, expect, test, vi } from "vitest";
import { createStreamingMarkdownDomRenderer } from "./streaming-markdown-dom-renderer";
import type { StreamingMarkdownDomRenderProps } from "./streaming-markdown-dom-renderer";

const NO_SEGMENTS = { segmenter: false } as const;
const CITED =
  "[link](https://example.com) cite [^ref]\n\n[^ref]: Ref https://example.org";

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const renderer = createStreamingMarkdownDomRenderer(container);
  const render = (props: StreamingMarkdownDomRenderProps) => {
    renderer.render(props);
    return container.querySelector<HTMLElement>(
      "[data-streaming-markdown-root]",
    )!;
  };
  return { container, renderer, render };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("createStreamingMarkdownDomRenderer", () => {
  test("renders the shared markup with a stylesheet next to the root", () => {
    const { container, render } = setup();
    const root = render({
      content: "# T\n\n**b** ~~x~~",
      isComplete: true,
      className: "extra",
    });

    expect(container.firstElementChild?.tagName).toBe("STYLE");
    expect(root.className).toBe("cpk-streaming-markdown-root extra");
    expect(root.querySelector("h1")?.textContent).toBe("T");
    expect(root.querySelector("strong")?.textContent).toBe("b");
    expect(root.querySelector("s")?.textContent).toBe("x");
  });

  test("renders an empty root for empty content", () => {
    const { render } = setup();
    expect(render({ content: "" }).childNodes).toHaveLength(0);
  });

  test("drops unsafe URLs", () => {
    const { render } = setup();
    const root = render({
      content: "[x](javascript:alert(1)) ![i](data:image/svg+xml,x)",
      isComplete: true,
    });
    expect(root.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(root.querySelector("img")?.hasAttribute("src")).toBe(false);
  });

  test("shows the caret in the open node only while streaming", () => {
    const { render } = setup();
    const streaming = render({
      content: "Para",
      caret: true,
      options: NO_SEGMENTS,
    });
    expect(
      streaming.querySelector("p [data-streaming-markdown-caret]"),
    ).not.toBeNull();

    const done = render({
      content: "Para",
      caret: true,
      isComplete: true,
      options: NO_SEGMENTS,
    });
    expect(done.querySelector("[data-streaming-markdown-caret]")).toBeNull();
  });

  test("keeps existing segment nodes when text is appended", () => {
    const { render } = setup();
    const first = render({ content: "Hello wor" });
    const helloBefore = first.querySelector(".cpk-streaming-markdown-segment");

    const next = render({ content: "Hello world, again" });
    expect(next.querySelector(".cpk-streaming-markdown-segment")).toBe(
      helloBefore,
    );
    expect(next.querySelector("p")?.textContent).toBe("Hello world, again");
  });

  test("replaces the output when the content is replaced", () => {
    const { render } = setup();
    render({ content: "```ts\nfirst\n```", isComplete: true });
    const root = render({ content: "**second**", isComplete: true });
    expect(root.textContent).toBe("second");
    expect(root.querySelector("pre")).toBeNull();
  });

  test("calls the latest link and citation callbacks", () => {
    const { render } = setup();
    const stale: string[] = [];
    const calls: string[] = [];
    render({
      content: CITED,
      isComplete: true,
      onLinkClick: (_e, url) => stale.push(url),
    });
    const root = render({
      content: CITED,
      isComplete: true,
      onLinkClick: (event, url) => {
        event.preventDefault();
        calls.push(`link:${url}`);
      },
      onCitationClick: (event, citation) => {
        event.preventDefault();
        calls.push(`cite:${citation.id}`);
      },
    });

    root
      .querySelector<HTMLElement>('a[href="https://example.com"] span')!
      .click();
    root.querySelector<HTMLElement>('sup a[role="doc-noteref"]')!.click();
    expect(calls).toEqual(["link:https://example.com", "cite:ref"]);
    expect(stale).toEqual([]);
  });

  test("uses a node renderer's output and reuses it while the node is unchanged", () => {
    const { render } = setup();
    const math = vi.fn(({ node, document }) => {
      const span = document.createElement("span");
      span.className = "tex";
      span.textContent = node.type === "math" ? node.text : "";
      return span;
    });
    const props = {
      options: { enableMath: true },
      nodeRenderers: { math },
    } satisfies Partial<StreamingMarkdownDomRenderProps>;

    const first = render({ ...props, content: "a $x^2$ b" });
    const tex = first.querySelector(".tex");
    expect(tex?.textContent).toBe("x^2");

    const next = render({ ...props, content: "a $x^2$ b c" });
    expect(next.querySelector(".tex")).toBe(tex);
    expect(math).toHaveBeenCalledTimes(1);
  });

  test("renders without a global document, using the container's document", () => {
    const serverDocument = document.implementation.createHTMLDocument("server");
    const container = serverDocument.createElement("div");
    vi.stubGlobal("document", undefined);

    const renderer = createStreamingMarkdownDomRenderer(container);
    renderer.render({ content: "**bold**", isComplete: true });
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });

  test("destroy removes the output and stops click callbacks", () => {
    const { container, renderer, render } = setup();
    const calls: string[] = [];
    const root = render({
      content: CITED,
      isComplete: true,
      onLinkClick: (_e, url) => calls.push(url),
    });
    const link = root.querySelector<HTMLElement>("a")!;

    renderer.destroy();
    container.appendChild(link);
    link.click();
    expect(calls).toEqual([]);
    expect(
      container.querySelector("[data-streaming-markdown-root]"),
    ).toBeNull();
  });
});
