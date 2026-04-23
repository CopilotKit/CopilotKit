import * as path from "node:path";
import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { findCopilotKitNodes } from "../find-copilotkit";
import { walkSameFileAncestors } from "../walk-ancestors";
import { parseSync } from "oxc-parser";

const fx = (name: string) => path.join(__dirname, "fixtures", name);
const read = (name: string) => fs.readFileSync(fx(name), "utf-8");

function parse(file: string) {
  const src = read(file);
  const res = parseSync(file, src, { lang: "tsx", sourceType: "module" });
  return { ast: res.program, src };
}

describe("walkSameFileAncestors", () => {
  it("returns empty chain when <CopilotKit> is the root JSX of its component", () => {
    const { ast, src } = parse("provider-no-chain.tsx");
    const [node] = findCopilotKitNodes(fx("provider-no-chain.tsx"), src);
    const chain = walkSameFileAncestors(
      node.jsxElement,
      ast,
      src,
      fx("provider-no-chain.tsx"),
    );
    expect(chain).toEqual([]);
  });

  it("returns outermost-first chain for nested wrappers", () => {
    const { ast, src } = parse("provider-with-chain.tsx");
    const [node] = findCopilotKitNodes(fx("provider-with-chain.tsx"), src);
    const chain = walkSameFileAncestors(
      node.jsxElement,
      ast,
      src,
      fx("provider-with-chain.tsx"),
    );
    expect(chain.map((p) => p.tagName)).toEqual([
      "AuthProvider",
      "ThemeProvider",
    ]);
    expect(chain[1].props.mode).toBe("dark");
  });

  it("records import source for imported ancestors", () => {
    const { ast, src } = parse("provider-with-imported-chain.tsx");
    const [node] = findCopilotKitNodes(
      fx("provider-with-imported-chain.tsx"),
      src,
    );
    const chain = walkSameFileAncestors(
      node.jsxElement,
      ast,
      src,
      fx("provider-with-imported-chain.tsx"),
    );
    expect(chain).toHaveLength(3);
    const [layout, auth, theme] = chain;

    expect(layout.tagName).toBe("Layout");
    expect(layout.importSource).toBe("./layout");
    expect(layout.importedName).toBe("default");
    expect(layout.isDefaultImport).toBe(true);

    expect(auth.tagName).toBe("AuthProvider");
    expect(auth.importSource).toBe("./providers/auth");
    expect(auth.importedName).toBe("AuthProvider");
    expect(auth.isDefaultImport).toBe(false);

    // User wrote `import { ThemeProvider as Theme }`. tagName is the local
    // alias; importedName is the exported symbol.
    expect(theme.tagName).toBe("Theme");
    expect(theme.importSource).toBe("./providers/theme");
    expect(theme.importedName).toBe("ThemeProvider");
    expect(theme.isDefaultImport).toBe(false);
  });

  it("records null importSource for locally-declared ancestors", () => {
    const { ast, src } = parse("provider-with-chain.tsx");
    const [node] = findCopilotKitNodes(fx("provider-with-chain.tsx"), src);
    const chain = walkSameFileAncestors(
      node.jsxElement,
      ast,
      src,
      fx("provider-with-chain.tsx"),
    );
    // AuthProvider + ThemeProvider declared locally in the fixture → no import info.
    for (const entry of chain) {
      expect(entry.importSource).toBeNull();
      expect(entry.importedName).toBeNull();
      expect(entry.isDefaultImport).toBe(false);
    }
  });
});
