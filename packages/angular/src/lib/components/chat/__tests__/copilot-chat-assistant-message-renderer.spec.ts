import { ApplicationRef } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import DOMPurify from "dompurify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotChatAssistantMessageRenderer } from "../copilot-chat-assistant-message-renderer";

const privatePurifierSupport = vi.hoisted(() => ({ supported: true }));

// Instances created with DOMPurify(window) can be made to report
// isSupported=false while the global instance stays supported. An unsupported
// DOMPurify instance returns its input unchanged from sanitize(), as the real
// library does when it has no usable DOM.
vi.mock("dompurify", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof DOMPurify }>();
  const realFactory = actual.default;
  const factory = new Proxy(realFactory, {
    apply(target, thisArg, args) {
      const instance = Reflect.apply(target, thisArg, args);
      return new Proxy(instance, {
        get(inner, prop, receiver) {
          if (!privatePurifierSupport.supported) {
            if (prop === "isSupported") return false;
            if (prop === "sanitize") return (dirty: string) => dirty;
          }
          return Reflect.get(inner, prop, receiver);
        },
      });
    },
  });
  return { ...actual, default: factory };
});

function createRenderer(content: string) {
  TestBed.resetTestingModule();
  const fixture = TestBed.createComponent(CopilotChatAssistantMessageRenderer);
  fixture.componentRef.setInput("content", content);
  fixture.detectChanges();
  const root = fixture.nativeElement.querySelector("div") as HTMLElement;
  return { fixture, root };
}

function render(content: string): HTMLElement {
  return createRenderer(content).root;
}

function eventHandlerAttributes(root: HTMLElement): string[] {
  const found: string[] = [];
  root.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith("on")) {
        found.push(`<${el.tagName.toLowerCase()} ${attr.name}>`);
      }
    }
  });
  return found;
}

function scriptUrls(root: HTMLElement): string[] {
  const found: string[] = [];
  root.querySelectorAll("*").forEach((el) => {
    for (const name of ["href", "src", "xlink:href", "action", "formaction"]) {
      const value = el.getAttribute(name);
      if (value && /^\s*javascript:/i.test(value)) {
        found.push(`<${el.tagName.toLowerCase()} ${name}="${value}">`);
      }
    }
  });
  return found;
}

describe("CopilotChatAssistantMessageRenderer markdown", () => {
  it("keeps ordinary markdown", () => {
    const root = render(
      "# Title\n\n**bold** and [link](https://example.com)\n\n- one\n- two",
    );
    expect(root.querySelector("h1")?.textContent).toBe("Title");
    expect(root.querySelector("strong")?.textContent).toBe("bold");
    const link = root.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(root.querySelectorAll("li").length).toBe(2);
  });

  it("keeps GFM task list checkboxes", () => {
    const root = render("- [x] done\n- [ ] todo");
    const boxes = Array.from(
      root.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
    );
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    expect(boxes.every((box) => box.disabled)).toBe(true);
  });

  it("replaces the rendered output when content changes", () => {
    const { fixture, root } = createRenderer("```ts\nfirst\n```");
    fixture.componentRef.setInput("content", "**second**");
    fixture.detectChanges();

    expect(root.querySelector("strong")?.textContent).toBe("second");
    expect(root.textContent).not.toContain("first");
    expect(root.querySelector(".code-block-container")).toBeNull();
  });
});

describe("CopilotChatAssistantMessageRenderer math", () => {
  it("preserves currency ranges as prose", () => {
    const root = render(
      "United at $349 (departing 08:00) and Delta at $289, both on time.",
    );
    expect(root.textContent).toContain("$349");
    expect(root.textContent).toContain("$289");
    expect(root.querySelector(".katex")).toBeNull();
  });

  it("leaves dollar signs in inline code untouched", () => {
    const root = render("Run `echo $PATH`.");
    expect(root.querySelector("code")?.textContent).toBe("echo $PATH");
    expect(root.querySelector(".katex")).toBeNull();
  });

  it("leaves dollar signs in link targets untouched", () => {
    const root = render("[t](https://e.com/?a=$x$)");
    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      "https://e.com/?a=$x$",
    );
  });

  it("renders inline and display math with MathML and layout styles", () => {
    const root = render(
      "Inline $e^{i\\pi} + 1 = 0$ and display $$\\frac{a}{b}$$\n\n$$\ny = 2\n$$",
    );
    expect(root.querySelectorAll(".katex").length).toBe(3);
    expect(root.querySelector(".katex-display")).not.toBeNull();
    expect(root.textContent).not.toContain("$e^{i\\pi} + 1 = 0$");

    const annotations = Array.from(
      root.querySelectorAll(
        'math > semantics > annotation[encoding="application/x-tex"]',
      ),
    ).map((el) => el.textContent ?? "");
    expect(annotations.some((text) => text.includes("\\frac"))).toBe(true);
    expect(annotations.map((text) => text.trim())).toContain("y = 2");

    const styled = Array.from(
      root.querySelectorAll<HTMLElement>(".katex-html [style]"),
    );
    expect(
      styled.some((el) => /height:\s*[\d.]+em/.test(el.style.cssText)),
    ).toBe(true);
  });
});

describe("CopilotChatAssistantMessageRenderer code blocks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    return writeText;
  }

  it("highlights code and adds a language label and copy button", () => {
    const root = render("```ts\nconst a = 1;\n```");
    expect(root.querySelector(".code-block-language")?.textContent).toBe("ts");
    expect(root.querySelector(".code-block-copy-button svg")).not.toBeNull();
    expect(root.querySelector("pre code.hljs.language-ts")).not.toBeNull();
    expect(root.querySelector(".hljs-keyword")?.textContent).toBe("const");
  });

  it("shows the code fence language label as text", () => {
    const lang = '"><img/src/onerror=window.__xss=4>';
    const root = render(`\`\`\`${lang}\nconsole.log(1)\n\`\`\``);
    expect(eventHandlerAttributes(root)).toEqual([]);
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".code-block-language")?.textContent).toBe(lang);
  });

  it("renders raw HTML inside a fenced code block as text", () => {
    const html =
      "<style>body{display:none}</style><script>x()</script><iframe></iframe>";
    const root = render(`\`\`\`html\n${html}\n\`\`\``);
    expect(root.querySelector("style, script, iframe")).toBeNull();
    expect(root.querySelector("pre code")?.textContent).toContain(html);
  });

  it("copies the raw code when the copy button is clicked", async () => {
    const writeText = stubClipboard();
    const root = render("```ts\nconst a = 1;\n```");
    root.querySelector<HTMLElement>(".code-block-copy-button span")!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith("const a = 1;");
  });

  it("marks only the clicked button as copied when code blocks are identical", async () => {
    stubClipboard();
    const root = render("```ts\nx\n```\n\n```ts\nx\n```");
    const [first, second] = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".code-block-copy-button"),
    );
    second.click();
    await vi.waitFor(() => expect(second.textContent).toContain("Copied"));
    expect(first.textContent).not.toContain("Copied");
  });

  it("resets the copied label after two seconds", async () => {
    stubClipboard();
    const { fixture, root } = createRenderer("```ts\nx\n```");
    vi.useFakeTimers();
    try {
      const button = root.querySelector<HTMLButtonElement>(
        ".code-block-copy-button",
      )!;
      button.click();
      await vi.waitFor(() => expect(button.textContent).toContain("Copied"));

      await vi.advanceTimersByTimeAsync(2000);
      fixture.detectChanges();
      expect(button.textContent).not.toContain("Copied");
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroys code block headers when the content is replaced or removed", () => {
    const { fixture } = createRenderer("```ts\na\n```\n\n```ts\nb\n```");
    const appRef = TestBed.inject(ApplicationRef);
    const viewsWithHeaders = appRef.viewCount;

    fixture.componentRef.setInput("content", "```ts\nc\n```");
    fixture.detectChanges();
    expect(appRef.viewCount).toBe(viewsWithHeaders - 1);

    fixture.destroy();
    expect(appRef.viewCount).toBe(viewsWithHeaders - 2);
  });
});

describe("CopilotChatAssistantMessageRenderer sanitization", () => {
  const cases: Array<{ name: string; content: string; selector: string }> = [
    {
      name: "<img onerror>",
      content: 'Hello <img src=x onerror="window.__xss=1"> world',
      selector: "img[onerror]",
    },
    {
      name: "<svg><animate onbegin>",
      content:
        '<svg><animate onbegin="window.__xss=2" attributeName=x dur=1s></animate></svg>',
      selector: "animate[onbegin]",
    },
    {
      name: "markdown javascript: link",
      content: "[x](javascript:window.__xss=3)",
      selector: 'a[href^="javascript:" i]',
    },
    {
      name: "<script>",
      content: "Hi <script>window.__xss=10</script> there",
      selector: "script",
    },
    {
      name: "<iframe srcdoc>",
      content:
        'Hi <iframe srcdoc="<script>parent.__xss=11</script>"></iframe> there',
      selector: "iframe",
    },
    {
      name: "<object>",
      content: 'Hi <object data="https://evil.example/x.swf"></object>',
      selector: "object",
    },
    {
      name: "<embed>",
      content: 'Hi <embed src="https://evil.example/x.swf">',
      selector: "embed",
    },
    {
      name: "<style> preceded by text",
      content: "Hi <style>body { display: none !important; }</style> there",
      selector: "style",
    },
    {
      name: '<a href="data:text/html,...">',
      content: '<a href="data:text/html,<script>alert(1)</script>">click</a>',
      selector: 'a[href^="data:"]',
    },
    {
      name: '<a href="vbscript:...">',
      content: '<a href="vbscript:msgbox(1)">click</a>',
      selector: 'a[href^="vbscript:" i]',
    },
  ];

  it.each(cases)("neutralizes $name", ({ content, selector }) => {
    const root = render(content);
    expect(root.querySelector(selector)).toBeNull();
    expect(eventHandlerAttributes(root)).toEqual([]);
    expect(scriptUrls(root)).toEqual([]);
  });

  // Like server rendering: no working sanitizer and no global document, so
  // the fallback may only write through the container it renders into.
  function renderWithoutDomPurify(content: string): HTMLElement {
    const { fixture, root } = createRenderer("");
    privatePurifierSupport.supported = false;
    vi.stubGlobal("document", undefined);
    try {
      fixture.componentRef.setInput("content", content);
      fixture.detectChanges();
      return root;
    } finally {
      vi.unstubAllGlobals();
      privatePurifierSupport.supported = true;
    }
  }

  it("renders the source as plain text when DOMPurify cannot run", () => {
    const source = '**bold** <img src=x onerror="window.__xss=1">';
    const root = renderWithoutDomPurify(source);
    expect(root.children.length).toBe(0);
    expect(root.textContent).toContain(source);
  });

  describe("when the host app configures the global DOMPurify instance", () => {
    afterEach(() => {
      DOMPurify.removeAllHooks();
      DOMPurify.clearConfig();
    });

    it("ignores host hooks that keep event handlers", () => {
      DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
        if (data.attrName === "onerror") {
          data.forceKeepAttr = true;
        }
      });
      const root = render('<img src=x onerror="window.__xss=5">');
      expect(eventHandlerAttributes(root)).toEqual([]);
    });
  });
});
