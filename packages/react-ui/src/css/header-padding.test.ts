import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const headerCss = fs.readFileSync(
  path.join(path.resolve(__dirname), "header.css"),
  "utf-8",
);

/**
 * Returns the declarations of a rule as it applies with no media query in
 * effect — i.e. the narrow-viewport (mobile) case.
 */
function baseDeclarationsFor(css: string, selector: string): string {
  // Drop every @media block so only unconditional rules remain.
  const withoutMediaBlocks = css.replace(
    /@media[^{]*\{(?:[^{}]*\{[^{}]*\}\s*)*\}/g,
    "",
  );

  const rule = new RegExp(
    `(?:^|\\})\\s*${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`,
  ).exec(withoutMediaBlocks);

  expect(rule, `expected an unconditional \`${selector}\` rule`).not.toBeNull();
  return rule![1];
}

describe("header horizontal padding (#2493)", () => {
  it("reserves horizontal padding on mobile, not only at the sm breakpoint", () => {
    const base = baseDeclarationsFor(headerCss, ".copilotKitHeader");

    // The header lays out `justify-content: space-between`, so the title sits
    // against the left edge and the close button against the right edge. With
    // padding declared only inside `@media (min-width: 640px)` both ran flush
    // to the viewport edge below 640px.
    expect(base).toMatch(/padding-left:/);
    expect(base).toMatch(/padding-right:/);
  });
});
