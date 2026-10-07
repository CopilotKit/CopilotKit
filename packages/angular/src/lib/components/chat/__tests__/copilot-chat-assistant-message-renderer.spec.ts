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

describe("CopilotChatAssistantMessageRenderer math parsing", () => {
  function render(content: string): string {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(
      CopilotChatAssistantMessageRenderer,
    );
    fixture.componentRef.setInput("content", content);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector("div").innerHTML;
  }

  it("preserves currency ranges as prose", () => {
    const rendered = render(
      "United at $349 (departing 08:00) and Delta at $289, both on time.",
    );

    expect(rendered).toContain("$349");
    expect(rendered).toContain("$289");
    expect(rendered).not.toContain('class="katex"');
  });

  it("renders inline math with non-whitespace delimiters", () => {
    const rendered = render("Euler's identity is $e^{i\\pi} + 1 = 0$.");

    expect(rendered).toContain('class="katex"');
    expect(rendered).not.toContain("$e^{i\\pi} + 1 = 0$");
  });

  it("leaves dollar signs in inline code untouched", () => {
    const rendered = render("Run `echo $PATH`.");

    expect(rendered).toContain("<code>echo $PATH</code>");
    expect(rendered).not.toContain('class="katex"');
  });
});

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

describe("CopilotChatAssistantMessageRenderer sanitization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderContainer(content: string): HTMLElement {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(
      CopilotChatAssistantMessageRenderer,
    );
    fixture.componentRef.setInput("content", content);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector("div") as HTMLElement;
  }

  it("strips event handlers from raw HTML images", () => {
    const root = renderContainer(
      'Hello <img src=x onerror="window.__xss=1"> world',
    );
    expect(eventHandlerAttributes(root)).toEqual([]);
  });

  it("strips event handlers from raw SVG animation elements", () => {
    const root = renderContainer(
      '<svg><animate onbegin="window.__xss=2" attributeName=x dur=1s></animate></svg>',
    );
    expect(eventHandlerAttributes(root)).toEqual([]);
  });

  it("removes javascript: link targets", () => {
    const root = renderContainer("[x](javascript:window.__xss=3)");
    expect(scriptUrls(root)).toEqual([]);
  });

  it("escapes the code fence language label", () => {
    const root = renderContainer(
      '```"><img src=x onerror=window.__xss=4>\nconsole.log(1)\n```',
    );
    expect(eventHandlerAttributes(root)).toEqual([]);
    expect(root.querySelector("img")).toBeNull();
  });

  it("keeps highlighted code blocks and the copy button", () => {
    const root = renderContainer("```ts\nconst a = 1;\n```");
    expect(root.querySelector(".code-block-language")?.textContent).toBe("ts");
    const button = root.querySelector(".code-block-copy-button");
    expect(button?.getAttribute("data-code-block-id")).toMatch(/^code-block-/);
    expect(button?.querySelector("svg")).not.toBeNull();
    expect(root.querySelector("pre code.hljs.language-ts")).not.toBeNull();
    expect(root.querySelector(".hljs-keyword")?.textContent).toBe("const");
  });

  it("keeps KaTeX output", () => {
    const root = renderContainer(
      "Inline $e^{i\\pi} + 1 = 0$ and display $$\\frac{a}{b}$$",
    );
    expect(root.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(root.querySelector(".katex-display")).not.toBeNull();
    expect(root.querySelector(".katex-html")).not.toBeNull();
    expect(root.querySelector("math")).not.toBeNull();
    const annotations = Array.from(root.querySelectorAll("annotation")).map(
      (el) => el.textContent ?? "",
    );
    expect(annotations.some((text) => text.includes("\\frac"))).toBe(true);
  });

  it("does not render KaTeX into raw math-placeholder HTML after sanitization", () => {
    const root = renderContainer(
      'Before <span class="math-placeholder" data-equation="x^2"></span> after',
    );
    expect(root.querySelector(".katex")).toBeNull();
    const placeholder = root.querySelector(".math-placeholder");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute("data-equation")).toBe("x^2");
    expect(placeholder?.querySelector(".katex")).toBeNull();
    expect(placeholder?.innerHTML).toBe("");
  });

  it("keeps KaTeX inline layout styles", () => {
    const root = renderContainer("Fraction $\\frac{a}{b}$ here");
    const styled = Array.from(
      root.querySelectorAll<HTMLElement>(".katex-html [style]"),
    );
    expect(styled.length).toBeGreaterThan(0);
    expect(
      styled.some((el) => /height:\s*[\d.]+em/.test(el.style.cssText)),
    ).toBe(true);
  });

  it("nests KaTeX annotations inside MathML semantics", () => {
    const root = renderContainer("Inline $e^{i\\pi} + 1 = 0$");
    const annotation = root.querySelector(
      'annotation[encoding="application/x-tex"]',
    );
    expect(annotation).not.toBeNull();
    expect(annotation?.parentElement?.tagName.toLowerCase()).toBe("semantics");
    expect(root.querySelector("math > semantics")).not.toBeNull();
  });

  it("sanitizes content updates after the first render", () => {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(
      CopilotChatAssistantMessageRenderer,
    );
    fixture.componentRef.setInput("content", "Hello");
    fixture.detectChanges();
    const root = fixture.nativeElement.querySelector("div") as HTMLElement;
    expect(root.textContent).toContain("Hello");

    fixture.componentRef.setInput(
      "content",
      'Hello <img src=x onerror="window.__xss=5"> world',
    );
    fixture.detectChanges();

    expect(root.textContent).toContain("world");
    expect(root.querySelector("img")).not.toBeNull();
    expect(eventHandlerAttributes(root)).toEqual([]);
  });

  it("copies the raw code when the copy button is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    const root = renderContainer("```ts\nconst a = 1;\n```");
    const button = root.querySelector<HTMLButtonElement>(
      ".code-block-copy-button",
    );
    expect(button).not.toBeNull();
    button!.querySelector("span")!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    expect(writeText).toHaveBeenCalledWith("const a = 1;");
  });

  it("keeps ordinary markdown", () => {
    const root = renderContainer(
      "# Title\n\n**bold** and [link](https://example.com)\n\n- one\n- two",
    );
    expect(root.querySelector("h1")?.textContent).toBe("Title");
    expect(root.querySelector("strong")?.textContent).toBe("bold");
    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com",
    );
    expect(root.querySelectorAll("li").length).toBe(2);
  });

  describe("neutralizes dangerous elements in model output", () => {
    const cases: Array<{ name: string; content: string; selector: string }> = [
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

    it.each(cases)("$name", ({ content, selector }) => {
      const root = renderContainer(content);
      expect(root.querySelector(selector)).toBeNull();
      expect(eventHandlerAttributes(root)).toEqual([]);
    });

    it("renders raw HTML inside a fenced code block as text", () => {
      const root = renderContainer(
        "```html\n<style>body{display:none}</style><script>x()</script><iframe></iframe>\n```",
      );
      const code = root.querySelector("pre code");
      expect(code).not.toBeNull();
      expect(code!.querySelector("style, script, iframe")).toBeNull();
      expect(root.querySelector("style, script, iframe")).toBeNull();
      expect(code!.textContent).toContain(
        "<style>body{display:none}</style><script>x()</script><iframe></iframe>",
      );
    });
  });

  function renderWithoutDomPurify(content: string): HTMLElement {
    privatePurifierSupport.supported = false;
    try {
      return renderContainer(content);
    } finally {
      privatePurifierSupport.supported = true;
    }
  }

  it("renders the markdown source as plain text when DOMPurify cannot run", () => {
    const root = renderWithoutDomPurify(
      "**bold** and [link](https://x.y)\n\n```ts\nconst a = 1;\n```",
    );
    expect(root.children.length).toBe(0);
    expect(root.textContent).toContain("**bold** and [link](https://x.y)");
    expect(root.textContent).toContain("const a = 1;");
    expect(root.textContent).not.toMatch(/<\/?(p|strong|a|pre|code|span)\b/);
  });

  it("produces no markup from a malicious payload when DOMPurify cannot run", () => {
    const root = renderWithoutDomPurify('<img src=x onerror="window.__xss=1">');
    expect(root.children.length).toBe(0);
    expect(root.querySelector("img")).toBeNull();
    expect(eventHandlerAttributes(root)).toEqual([]);
    expect(root.textContent).toContain('<img src=x onerror="window.__xss=1">');
  });

  it("renders escaped source when the sanitizing instance is unsupported but the global one is", () => {
    expect(DOMPurify.isSupported).toBe(true);
    const root = renderWithoutDomPurify('<img src=x onerror="window.__xss=1">');
    expect(root.querySelector("img")).toBeNull();
    expect(eventHandlerAttributes(root)).toEqual([]);
    expect(root.children.length).toBe(0);
    expect(root.textContent).toContain('<img src=x onerror="window.__xss=1">');
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
      const root = renderContainer('<img src=x onerror="window.__xss=5">');
      expect(eventHandlerAttributes(root)).toEqual([]);
    });

    it("ignores host config and keeps KaTeX semantics", () => {
      DOMPurify.setConfig({ ALLOWED_TAGS: ["p", "span", "img"] });
      const root = renderContainer(
        'Display $$\\frac{a}{b}$$ <img src=x onerror="window.__xss=6">',
      );
      expect(eventHandlerAttributes(root)).toEqual([]);
      expect(root.querySelector("math semantics")).not.toBeNull();
      expect(root.querySelector("annotation")?.textContent).toContain("\\frac");
    });
  });
});
