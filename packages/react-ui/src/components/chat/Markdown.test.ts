import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * These tests verify that CSS selectors in markdown.css correctly target
 * the class names used by the Markdown component. When the p tag was changed
 * to a div (to fix hydration errors), the CSS selectors must use class-only
 * selectors instead of element-qualified selectors for paragraphs.
 */

const cssPath = resolve(__dirname, "../../css/markdown.css");
const tsxPath = resolve(__dirname, "Markdown.tsx");

const cssContent = readFileSync(cssPath, "utf-8");
const tsxContent = readFileSync(tsxPath, "utf-8");

describe("Markdown CSS/component selector consistency", () => {
  it("should not use p.copilotKitMarkdownElement selector in CSS", () => {
    // After the p->div change, CSS must not use element-qualified p selectors
    expect(cssContent).not.toMatch(/\bp\.copilotKitMarkdownElement\b/);
  });

  it("should have .copilotKitParagraph selector in CSS for paragraph styling", () => {
    expect(cssContent).toMatch(/\.copilotKitParagraph\s*\{/);
  });

  it("should have .copilotKitParagraph:not(:last-child) selector for paragraph spacing", () => {
    expect(cssContent).toMatch(/\.copilotKitParagraph:not\(:last-child\)/);
  });

  it("should use copilotKitParagraph class on the paragraph component", () => {
    // The p component override in Markdown.tsx should include copilotKitParagraph
    expect(tsxContent).toMatch(/copilotKitParagraph/);
  });

  it("should render a div instead of p for the paragraph component", () => {
    // The paragraph component should use <div> to avoid hydration errors
    // when block-level elements are nested inside markdown paragraphs
    const pComponentMatch = tsxContent.match(
      /p:\s*\(\{[^}]*\}\)\s*=>\s*\(\s*<(\w+)/,
    );
    expect(pComponentMatch).not.toBeNull();
    expect(pComponentMatch![1]).toBe("div");
  });

  it("should still have copilotKitMarkdownElement class on the paragraph div", () => {
    // The div should retain the base class for any shared styling
    const pSection = tsxContent.match(/p:\s*\([^)]*\)\s*=>\s*\([^)]+\)/s);
    expect(pSection).not.toBeNull();
    expect(pSection![0]).toContain("copilotKitMarkdownElement");
  });

  it("should use .copilotKitParagraph (not p) inside blockquote selector", () => {
    // After p->div, blockquote nested paragraph selector must target the class
    expect(cssContent).toMatch(
      /blockquote\.copilotKitMarkdownElement\s+\.copilotKitParagraph\s*\{/,
    );
    expect(cssContent).not.toMatch(
      /blockquote\.copilotKitMarkdownElement\s+p\s*\{/,
    );
  });

  describe("other element selectors remain valid", () => {
    const elementSelectors = [
      { element: "h1", selector: "h1.copilotKitMarkdownElement" },
      { element: "h2", selector: "h2.copilotKitMarkdownElement" },
      { element: "h3", selector: "h3.copilotKitMarkdownElement" },
      { element: "h4", selector: "h4.copilotKitMarkdownElement" },
      { element: "h5", selector: "h5.copilotKitMarkdownElement" },
      { element: "h6", selector: "h6.copilotKitMarkdownElement" },
      { element: "a", selector: "a.copilotKitMarkdownElement" },
      { element: "pre", selector: "pre.copilotKitMarkdownElement" },
      {
        element: "blockquote",
        selector: "blockquote.copilotKitMarkdownElement",
      },
      { element: "ul", selector: "ul.copilotKitMarkdownElement" },
      { element: "li", selector: "li.copilotKitMarkdownElement" },
    ];

    for (const { element, selector } of elementSelectors) {
      it(`should have ${element} component rendering <${element}> with copilotKitMarkdownElement class`, () => {
        // Verify the component still uses the actual HTML element
        // Some components use arrow syntax, others use function syntax
        const arrowRegex = new RegExp(
          `${element}:\\s*\\(\\{[^}]*\\}\\)\\s*=>\\s*\\(\\s*<${element}[\\s\\S]*?copilotKitMarkdownElement`,
        );
        const funcRegex = new RegExp(
          `${element}\\([^)]*\\)\\s*\\{[\\s\\S]*?<${element}[\\s\\S]*?copilotKitMarkdownElement`,
        );
        const matches =
          arrowRegex.test(tsxContent) || funcRegex.test(tsxContent);
        expect(matches).toBe(true);
      });

      it(`should have CSS selector ${selector}`, () => {
        expect(cssContent).toContain(selector);
      });
    }
  });
});
