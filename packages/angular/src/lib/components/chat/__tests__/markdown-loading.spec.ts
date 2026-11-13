import { afterEach, describe, expect, it, vi } from "vitest";

// The loaders keep their state in the module, so each test imports a fresh
// copy with highlight.js and KaTeX mocked to fail until `failing` is false.
let failing = true;

async function freshMarkdown() {
  vi.resetModules();
  const failFirst = async (importOriginal: () => Promise<unknown>) => {
    if (failing) throw new Error("chunk failed");
    return importOriginal();
  };
  vi.doMock("highlight.js/lib/common", failFirst);
  vi.doMock("katex", failFirst);
  return import("../markdown");
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("markdown library loading", () => {
  afterEach(() => {
    failing = true;
    vi.doUnmock("highlight.js/lib/common");
    vi.doUnmock("katex");
    vi.resetModules();
  });

  it("keeps the plain fallback when a load fails, and loads again on a later render", async () => {
    const { renderMarkdown } = await freshMarkdown();
    const source = "```ts\nconst a = 1;\n```\n\n$x^2$";
    const render = () => renderMarkdown(source, () => {}) as DocumentFragment;

    // The render starts both loads; their failure must not be unhandled.
    const first = render();
    await settle();
    expect(first.querySelector(".katex-pending")).not.toBeNull();
    expect(first.querySelector("code .hljs-keyword")).toBeNull();

    failing = false;
    render();
    await settle();
    const retried = render();
    expect(retried.querySelector(".katex")).not.toBeNull();
    expect(retried.querySelector("code .hljs-keyword")).not.toBeNull();
  });

  it("rejects preloadMarkdownLibraries on a failed load, and succeeds on the next call", async () => {
    const { preloadMarkdownLibraries } = await freshMarkdown();
    await expect(preloadMarkdownLibraries()).rejects.toThrow();
    failing = false;
    await expect(preloadMarkdownLibraries()).resolves.toBeUndefined();
  });
});
