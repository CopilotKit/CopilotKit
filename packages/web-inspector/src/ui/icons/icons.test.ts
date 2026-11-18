// @vitest-environment node

import { describe, expect, it } from "vitest";

import { readFileSync, readdirSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { ICON_NODES } from "./icons.js";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const iconsModule = fileURLToPath(new URL("./icons.ts", import.meta.url));

/** Every production module, where the Inspector's icon names are spelled. */
function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolvePath(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "testing" || entry.name === "__tests__"
        ? []
        : productionSources(path);
    }
    if (
      !entry.name.endsWith(".ts") ||
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".spec.ts") ||
      path === iconsModule
    ) {
      return [];
    }
    return [readFileSync(path, "utf8")];
  });
}

const inspectorSource = productionSources(sourceRoot).join("\n");

/** Text between the parentheses of each `renderIcon(...)` call. */
function renderIconArguments(source: string): string[] {
  const args: string[] = [];
  const marker = "renderIcon(";
  let from = source.indexOf(marker);
  while (from !== -1) {
    const start = from + marker.length;
    let depth = 1;
    let end = start;
    while (depth > 0 && end < source.length) {
      if (source[end] === "(") depth += 1;
      if (source[end] === ")") depth -= 1;
      end += 1;
    }
    args.push(source.slice(start, end - 1));
    from = source.indexOf(marker, end);
  }
  return args;
}

/**
 * Every icon name the Inspector source spells out: PascalCase string literals
 * passed to `renderIcon` (both arms of a ternary, not its condition) and `icon: "…"` fields on the
 * menu, HUD, story-chain, and locked-feature tables that feed `renderIcon`.
 */
function iconNamesInSource(source: string): Set<string> {
  const names = new Set<string>();
  for (const arg of renderIconArguments(source)) {
    for (const match of arg.matchAll(/"([A-Z][A-Za-z0-9]*)"/g))
      names.add(match[1]!);
  }
  for (const match of source.matchAll(/\bicon: "([A-Z][A-Za-z0-9]*)"/g)) {
    names.add(match[1]!);
  }
  return names;
}

const SVG_CHILD_TAGS = new Set([
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "ellipse",
]);

describe("vendored Lucide icons", () => {
  const usedNames = iconNamesInSource(inspectorSource);

  it("finds the icon names the Inspector renders", () => {
    // Guards the extraction itself: if the patterns stop matching, the
    // resolution checks below would pass vacuously.
    expect(usedNames.size).toBeGreaterThan(40);
    expect(usedNames).toContain("Home");
    expect(usedNames).toContain("ShieldCheck");
    expect(usedNames).toContain("PanelLeft");
  });

  it("vendors every icon name the Inspector renders", () => {
    const missing = [...usedNames].filter((name) => !(name in ICON_NODES));
    expect(missing).toEqual([]);
  });

  it("vendors no icon the Inspector does not render", () => {
    // Views also pass icon names through helpers such as
    // `renderToolbarButton(label, "Trash2", …)`, so an icon counts as used
    // when production code spells its name as a string literal anywhere.
    const unused = Object.keys(ICON_NODES).filter(
      (name) => !usedNames.has(name) && !inspectorSource.includes(`"${name}"`),
    );
    expect(unused).toEqual([]);
  });

  it("stores only plain SVG shape elements with string attributes", () => {
    for (const [name, node] of Object.entries(ICON_NODES)) {
      expect(node.length, name).toBeGreaterThan(0);
      for (const [tag, attributes] of node) {
        expect(SVG_CHILD_TAGS.has(tag), `${name}: <${tag}>`).toBe(true);
        for (const [key, value] of Object.entries(attributes)) {
          expect(key, name).toMatch(/^[a-z][a-z0-9-]*$/);
          expect(typeof value, `${name}.${key}`).toBe("string");
          expect(value, `${name}.${key}`).not.toMatch(/["<>]/);
        }
      }
    }
  });
});
