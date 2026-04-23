import * as path from "node:path";
import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { scanFile } from "../../hooks/hook-scanner";
import { mapHooksToComponents } from "../map-hooks-to-components";

const fx = (name: string) => path.join(__dirname, "fixtures", name);
const read = (name: string) => fs.readFileSync(fx(name), "utf-8");

describe("mapHooksToComponents", () => {
  it("groups multiple hooks by their enclosing function declaration", () => {
    const sites = scanFile(fx("hooks-in-components.tsx"));
    const src = read("hooks-in-components.tsx");
    const { components, warnings } = mapHooksToComponents(
      fx("hooks-in-components.tsx"),
      src,
      sites,
    );
    expect(components).toHaveLength(2);
    const byName = Object.fromEntries(components.map((c) => [c.componentName, c]));
    expect(byName.MyPage.hooks).toHaveLength(2);
    expect(byName.Sidebar.hooks).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("resolves arrow-function components and their default export name", () => {
    const sites = scanFile(fx("hooks-in-arrow.tsx"));
    const src = read("hooks-in-arrow.tsx");
    const { components } = mapHooksToComponents(
      fx("hooks-in-arrow.tsx"),
      src,
      sites,
    );
    expect(components).toHaveLength(1);
    expect(components[0].componentName).toBe("Page");
    expect(components[0].exportName).toBe("default");
  });

  it("handles `export default function Foo` without duplicating the component", () => {
    const sites = scanFile(fx("hooks-in-default-function.tsx"));
    const src = read("hooks-in-default-function.tsx");
    const { components, warnings } = mapHooksToComponents(
      fx("hooks-in-default-function.tsx"),
      src,
      sites,
    );
    expect(components).toHaveLength(1);
    expect(components[0].componentName).toBe("Main");
    expect(components[0].exportName).toBe("default");
    expect(warnings).toEqual([]);
  });

  it("emits a warning for hooks that aren't inside any component", () => {
    const sites = scanFile(fx("hooks-top-level.tsx"));
    const src = read("hooks-top-level.tsx");
    const { components, warnings } = mapHooksToComponents(
      fx("hooks-top-level.tsx"),
      src,
      sites,
    );
    expect(components).toHaveLength(1);
    expect(components[0].componentName).toBe("OK");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe("hook-outside-component");
  });
});
