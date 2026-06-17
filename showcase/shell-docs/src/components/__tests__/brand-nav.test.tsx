import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const brandNavSource = readFileSync(
  new URL("../brand-nav.tsx", import.meta.url),
  "utf8",
);
const globalsCss = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

describe("BrandNav layout", () => {
  it("uses a CSS class for the same desktop layout cap as the docs grid", () => {
    expect(brandNavSource).toContain("shell-docs-brand-nav-inner");
    expect(globalsCss).toContain(".shell-docs-brand-nav-inner");
    expect(globalsCss).toContain(
      "--shell-docs-layout-width: calc(97rem + 11px);",
    );
    expect(brandNavSource).not.toContain("max-w-[calc(");
    expect(brandNavSource).not.toContain("max-w-[1534px]");
  });
});
