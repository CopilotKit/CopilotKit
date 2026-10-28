import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SAMPLES } from "@/components/standard-catalog/catalog-data";
import {
  catalogComponentNames,
  catalogStandaloneNames,
  catalogComponentHref,
  catalogComponentSlug,
  catalogParts,
  catalogExamples,
  catalogReferenceName,
  catalogReferenceNav,
  CATALOG_REFERENCE_PATH,
} from "@/components/standard-catalog/catalog-reference";

describe("component reference navigation", () => {
  it("retains every component pill as a searchable Markdown link to its canonical destination", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/content/docs/generative-ui/components/standard-catalog.mdx",
      ),
      "utf8",
    );
    for (const name of catalogComponentNames())
      expect(source).toContain(
        "[`" + name + "`](" + catalogComponentHref(name) + ")",
      );
  });
  it("assigns every component exactly one page or a section on its parent page", () => {
    const names = [
      ...new Set(SAMPLES.flatMap((sample) => sample.covers)),
    ].sort();
    expect(catalogComponentNames().sort()).toEqual(names);
    const pages = catalogStandaloneNames();
    expect(pages).toHaveLength(59);
    expect(
      pages.flatMap((name) => [name, ...catalogParts(name)]).sort(),
    ).toEqual(names);
    for (const name of names) {
      const href = catalogComponentHref(name);
      const [path, anchor] = href.split("#");
      const page = catalogReferenceName(
        path.slice(CATALOG_REFERENCE_PATH.length + 1),
      );
      expect(page).toBeTruthy();
      if (anchor) expect(catalogParts(page!)).toContain(name);
      expect(catalogExamples(name).length).toBeGreaterThan(0);
    }
  });

  it("links structural parts to their parents and refuses unknown page names", () => {
    expect(catalogComponentHref("GridItem")).toBe(
      `${CATALOG_REFERENCE_PATH}/grid#grid-item`,
    );
    expect(catalogComponentHref("TableCell")).toBe(
      `${CATALOG_REFERENCE_PATH}/table#table-cell`,
    );
    expect(catalogComponentHref("ListItem")).toBe(
      `${CATALOG_REFERENCE_PATH}/list#list-item`,
    );
    expect(catalogComponentHref("PopoverTrigger")).toBe(
      `${CATALOG_REFERENCE_PATH}/popover#popover-trigger`,
    );
    expect(catalogReferenceName("grid-item")).toBeUndefined();
    expect(catalogReferenceName("not-a-component")).toBeUndefined();
    expect(catalogReferenceName(catalogComponentSlug("TextField"))).toBe(
      "TextField",
    );
  });

  it("gives the focused sidebar only the index, category headings, and standalone pages", () => {
    const tree = catalogReferenceNav();
    const pages = tree.filter((node) => node.type === "page");
    expect(pages).toHaveLength(catalogStandaloneNames().length + 1);
    expect(pages[0]).toMatchObject({
      title: "Overview",
      href: CATALOG_REFERENCE_PATH,
    });
    expect(pages.some((page) => page.title === "GridItem")).toBe(false);
    expect(
      tree.some((node) => node.type === "section" && node.title === "Layout"),
    ).toBe(true);
    expect(tree.some((node) => node.type === "group")).toBe(false);
  });
});
