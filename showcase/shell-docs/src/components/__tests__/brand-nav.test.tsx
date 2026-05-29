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
  it("uses the same desktop layout cap as the docs grid", () => {
    expect(globalsCss).toContain("--shell-docs-scrollbar-gutter: 11px;");
    expect(brandNavSource).toContain(
      "max-w-[calc(97rem+var(--shell-docs-scrollbar-gutter))]",
    );
    expect(brandNavSource).not.toContain("max-w-[1534px]");
  });
});
