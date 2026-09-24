// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const highlighter = vi.hoisted(() => ({ imports: 0 }));

vi.mock("react-syntax-highlighter", async () => {
  highlighter.imports += 1;
  return {
    Prism: ({ children }: { children: React.ReactNode }) =>
      React.createElement("pre", { "data-highlighter": "prism" }, children),
    Light: ({ children }: { children: React.ReactNode }) =>
      React.createElement("pre", { "data-highlighter": "light" }, children),
  };
});

const roots: Root[] = [];
const containers: HTMLDivElement[] = [];

async function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(element);
  });
  return container;
}

async function withoutGlobalThis<T>(run: () => Promise<T>): Promise<T> {
  const scope = globalThis;
  const descriptor = Object.getOwnPropertyDescriptor(scope, "globalThis");
  Object.defineProperty(scope, "globalThis", {
    configurable: true,
    value: undefined,
  });
  try {
    return await run();
  } finally {
    if (descriptor) Object.defineProperty(scope, "globalThis", descriptor);
  }
}

afterEach(async () => {
  await act(async () => {
    roots.splice(0).forEach((root) => root.unmount());
  });
  containers.splice(0).forEach((container) => container.remove());
  vi.unstubAllGlobals();
});

describe("CodeBlock highlighting", () => {
  it("loads no grammar for ordinary markdown or inline code, then highlights a code block", async () => {
    const { Markdown } = await import("./Markdown");
    expect(highlighter.imports).toBe(0);

    const container = await render(
      React.createElement(Markdown, { content: "Hello `inline` code." }),
    );
    expect(container.textContent).toContain("inline");
    expect(highlighter.imports).toBe(0);

    await act(async () => {
      roots[0].render(
        React.createElement(Markdown, {
          content: "```javascript\nconst answer = 42;\n```",
        }),
      );
    });
    expect(highlighter.imports).toBe(1);
    expect(
      container.querySelector('[data-highlighter="prism"]')?.textContent,
    ).toContain("const answer = 42;");
  });

  it("uses the Light fallback when lookbehind is unsupported", async () => {
    const NativeRegExp = RegExp;
    vi.stubGlobal(
      "RegExp",
      class extends NativeRegExp {
        constructor(pattern: string | RegExp, flags?: string) {
          if (pattern === "(?<=#)\\w+") {
            throw new SyntaxError("Lookbehind unsupported");
          }
          super(pattern, flags);
        }
      },
    );

    const { CodeBlock } = await import("./CodeBlock");
    const container = await render(
      React.createElement(CodeBlock, {
        language: "python",
        value: "print('hello')",
      }),
    );
    vi.unstubAllGlobals();
    expect(
      container.querySelector('[data-highlighter="light"]')?.textContent,
    ).toBe("print('hello')");
  });

  it("uses the existing UMD global when one is provided", async () => {
    vi.stubGlobal("ReactSyntaxHighlighter", {
      Prism: ({ children }: { children: React.ReactNode }) =>
        React.createElement(
          "pre",
          { "data-highlighter": "global-prism" },
          children,
        ),
      Light: ({ children }: { children: React.ReactNode }) =>
        React.createElement(
          "pre",
          { "data-highlighter": "global-light" },
          children,
        ),
    });

    const { CodeBlock } = await import("./CodeBlock");
    const container = await render(
      React.createElement(CodeBlock, { language: "js", value: "const x = 1" }),
    );
    expect(
      container.querySelector('[data-highlighter="global-prism"]')?.textContent,
    ).toBe("const x = 1");
  });

  it("uses the window highlighter when globalThis is unavailable", async () => {
    const windowWithHighlighter = window as typeof window & {
      ReactSyntaxHighlighter?: {
        Prism: React.FC<{ children: React.ReactNode }>;
      };
    };
    windowWithHighlighter.ReactSyntaxHighlighter = {
      Prism: ({ children }) =>
        React.createElement(
          "pre",
          { "data-highlighter": "window-prism" },
          children,
        ),
    };
    try {
      const { CodeBlock } = await import("./CodeBlock");
      const container = await withoutGlobalThis(() =>
        render(
          React.createElement(CodeBlock, {
            language: "js",
            value: "const x = 1",
          }),
        ),
      );
      expect(
        container.querySelector('[data-highlighter="window-prism"]')
          ?.textContent,
      ).toBe("const x = 1");
    } finally {
      delete windowWithHighlighter.ReactSyntaxHighlighter;
    }
  });

  it("keeps code readable when neither global is available", async () => {
    const { CodeBlock } = await import("./CodeBlock");
    const container = await withoutGlobalThis(() =>
      render(
        React.createElement(CodeBlock, {
          language: "js",
          value: "const y = 2",
        }),
      ),
    );
    expect(container.querySelector("code")?.textContent).toBe("const y = 2");
  });
});
