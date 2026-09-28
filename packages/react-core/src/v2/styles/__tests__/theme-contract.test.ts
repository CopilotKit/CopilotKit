import { readFileSync } from "node:fs";
import { parse } from "postcss";
import type { Rule } from "postcss";
import { describe, expect, it } from "vitest";

const root = parse(
  readFileSync("src/v2/styles/globals.css", { encoding: "utf8" }),
);

function rulesDeclaring(property: string): Rule[] {
  const rules: Rule[] = [];
  root.walkDecls(property, (decl) => {
    if (decl.parent?.type === "rule") rules.push(decl.parent as Rule);
  });
  return rules;
}

describe("globals.css contract", () => {
  it("declares theme tokens on the outermost CopilotKit root only, at bare-root specificity", () => {
    // Nested [data-copilotkit] elements inherit the tokens (including ones a
    // host set on the root) instead of redeclaring the defaults.
    const outermost = ":where(:not([data-copilotkit] [data-copilotkit]))";
    expect(
      rulesDeclaring("--background").flatMap((rule) => rule.selectors),
    ).toEqual([
      `[data-copilotkit]${outermost}`,
      `.dark [data-copilotkit]${outermost}`,
      `[data-copilotkit].dark`,
    ]);
  });

  it("gives dark tokens to a nested root that has .dark itself", () => {
    // <CopilotPopup className="dark"> puts .dark on the chat view, a root
    // nested inside the popup's own root.
    document.body.innerHTML = `<div data-copilotkit><div data-copilotkit class="dark"></div></div>`;
    const nested = document.querySelector(".dark")!;
    const [, darkRule] = rulesDeclaring("--background");
    expect(
      darkRule!.selectors.some((selector) => nested.matches(selector)),
    ).toBe(true);
  });

  it("sets color-scheme only for dark roots", () => {
    const values: string[] = [];
    root.walkDecls("color-scheme", (decl) => {
      values.push(decl.value);
    });
    expect(values).toEqual(["dark"]);
  });

  it("does not hold the intro animation's end state after it plays", () => {
    const intro: string[] = [];
    root.walkDecls("animation", (decl) => {
      if (decl.value.startsWith("cpk-intro ")) intro.push(decl.value);
    });
    expect(intro).toHaveLength(1);
    expect(intro[0]).toMatch(/ backwards$/);
  });

  it("keeps the inline cursor rule separate from its :has() fallback", () => {
    // A browser without :has() drops a whole rule over one selector it can't
    // parse, which would take the inline cursor down with it.
    const cursorRules = rulesDeclaring("animation").filter((rule) =>
      rule.selector.includes("[data-streaming-cursor]"),
    );
    const anchorRule = cursorRules.find((rule) =>
      rule.selector.includes("[data-cursor-anchor]::after"),
    );
    expect(anchorRule?.selector).not.toContain(":has(");
    expect(cursorRules.some((rule) => rule.selector.includes(":has("))).toBe(
      true,
    );
  });

  it("hides the composer preview under forced colors", () => {
    const forcedColors: string[] = [];
    root.walkAtRules("media", (media) => {
      if (media.params.includes("forced-colors: active")) {
        forcedColors.push(media.toString());
      }
    });
    expect(forcedColors.join("\n")).toMatch(
      /\.cpk-md-preview\s*\{\s*display:\s*none;/,
    );
  });

  it("generates the classes @copilotkit/a2ui-renderer relies on", () => {
    const sources: string[] = [];
    root.walkAtRules("source", (source) => {
      sources.push(source.params);
    });
    expect(sources).toContain('inline("cpk:text-gray-400")');
  });
});
