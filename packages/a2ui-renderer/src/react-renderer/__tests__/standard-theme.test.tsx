import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { A2UIProvider } from "../core/A2UIProvider";
import { A2UIRenderer, themeToCssVariables } from "../core/A2UIRenderer";
import { useA2UI } from "../hooks/useA2UI";
import {
  standardCatalog,
  STANDARD_CATALOG_ID,
} from "../a2ui-react/catalog/standard";
import { renderStandard } from "./standard-test-utils";

function Surface({ ops }: { ops: unknown[] }) {
  const { processMessages } = useA2UI();
  useEffect(() => {
    processMessages(ops as Array<Record<string, unknown>>);
  }, [ops, processMessages]);
  return <A2UIRenderer surfaceId="s" />;
}

/**
 * The standard catalog has no colours of its own: every colour, radius,
 * shadow and font is `var(--a2ui-…, fallback)`, and the provider's `theme`
 * sets those variables on the surface.
 */
describe("standard catalog: theme and tokens", () => {
  it("applies --a2ui-* theme keys as CSS variables on the surface element", async () => {
    const ops = [
      {
        version: "v0.9",
        createSurface: { surfaceId: "s", catalogId: STANDARD_CATALOG_ID },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [{ id: "root", component: "Text", text: "Hi" }],
        },
      },
    ];
    const v = render(
      <A2UIProvider
        catalog={standardCatalog}
        theme={{
          "--a2ui-color-accent": "rgb(15, 118, 110)",
          "--a2ui-radius-lg": "4px",
          unrelated: "ignored",
        }}
      >
        <Surface ops={ops} />
      </A2UIProvider>,
    );
    await v.findByText("Hi");
    const surface = v.container.querySelector(".a2ui-surface") as HTMLElement;
    expect(surface.style.getPropertyValue("--a2ui-color-accent")).toBe(
      "rgb(15, 118, 110)",
    );
    expect(surface.style.getPropertyValue("--a2ui-radius-lg")).toBe("4px");
    expect(surface.getAttribute("style")).not.toContain("unrelated");
  });

  it("themeToCssVariables keeps only --a2ui-* string and number entries", () => {
    expect(themeToCssVariables(undefined)).toBeUndefined();
    expect(themeToCssVariables({})).toBeUndefined();
    expect(
      themeToCssVariables({
        "--a2ui-chart-1": "#123456",
        "--a2ui-radius-md": 8,
        "--a2ui-bad": { nested: true },
        color: "red",
      }),
    ).toEqual({ "--a2ui-chart-1": "#123456", "--a2ui-radius-md": "8" });
  });

  it("renders solid buttons and badges with token colours, not literals", async () => {
    const v = renderStandard([
      { id: "root", component: "Column", children: ["b", "g"] },
      {
        id: "b",
        component: "Button",
        label: "Go",
        variant: "solid",
        action: { event: { name: "go" } },
      },
      { id: "g", component: "Badge", label: "New", variant: "solid" },
    ]);
    const button = (await v.findByText("Go")).closest("button") as HTMLElement;
    expect(button.style.color).toBe("var(--a2ui-color-on-accent, #fff)");
    const badge = v.getByText("New").closest("span") as HTMLElement;
    expect(badge.style.color).toBe("var(--a2ui-color-on-accent, #fff)");
  });
});

describe("useStableValue", () => {
  it("keeps the previous reference while the content is equal", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useStableValue } =
      await import("../a2ui-react/catalog/standard/renderers/Chart");
    const { result, rerender } = renderHook(
      ({ v }: { v: unknown[] }) => useStableValue(v),
      { initialProps: { v: [{ day: "Mon", food: 1 }] } },
    );
    const first = result.current;
    rerender({ v: [{ day: "Mon", food: 1 }] });
    expect(result.current).toBe(first);
    rerender({ v: [{ day: "Mon", food: 2 }] });
    expect(result.current).not.toBe(first);
    expect(result.current).toEqual([{ day: "Mon", food: 2 }]);
  });
});

describe("map style filter guard", () => {
  it("guards numeric property comparisons with a has check, recursively", async () => {
    const { guardNumericFilter, guardStyleFilters } =
      await import("../a2ui-react/catalog/standard/renderers/Map");
    const filter = [
      "all",
      ["<=", ["get", "ref_length"], 6],
      ["match", ["geometry-type"], ["LineString"], true, false],
    ];
    expect(guardNumericFilter(filter)).toEqual([
      "all",
      ["all", ["has", "ref_length"], ["<=", ["get", "ref_length"], 6]],
      ["match", ["geometry-type"], ["LineString"], true, false],
    ]);
    // Comparisons that do not read a property, or compare two properties, stay.
    expect(guardNumericFilter([">", ["zoom"], 5])).toEqual([">", ["zoom"], 5]);
    expect(guardNumericFilter(["==", ["get", "rank"], 1])).toEqual([
      "==",
      ["get", "rank"],
      1,
    ]);
    const style = {
      version: 8,
      layers: [{ id: "a", filter: [">=", ["get", "rank"], 2] }, { id: "b" }],
    };
    expect(guardStyleFilters(style).layers).toEqual([
      { id: "a", filter: ["all", ["has", "rank"], [">=", ["get", "rank"], 2]] },
      { id: "b" },
    ]);
  });
});

describe("Svg sizing", () => {
  it("treats numeric width and height as pixels", async () => {
    const v = renderStandard([
      {
        id: "root",
        component: "Svg",
        viewBox: "0 0 10 10",
        width: 240,
        height: 80,
        circles: [{ cx: 5, cy: 5, r: 4 }],
      },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    const svg = v.container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("240");
    expect(svg.getAttribute("height")).toBe("80");
  });
});
