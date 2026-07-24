import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const cssRoot = path.resolve(__dirname);

const sidebarScopedSelectors = [
  {
    file: "window.css",
    selector: ".copilotKitWindow",
  },
  {
    file: "header.css",
    selector: ".copilotKitHeader",
  },
  {
    file: "input.css",
    selector: ".copilotKitInputContainer",
  },
];

describe("sidebar CSS specificity", () => {
  it("keeps sidebar variant selectors easy to override", () => {
    for (const { file, selector } of sidebarScopedSelectors) {
      const css = fs.readFileSync(path.join(cssRoot, file), "utf-8");

      expect(css).not.toContain(`.copilotKitSidebar ${selector}`);
      expect(css).toContain(`:where(.copilotKitSidebar) ${selector}`);
    }
  });
});
