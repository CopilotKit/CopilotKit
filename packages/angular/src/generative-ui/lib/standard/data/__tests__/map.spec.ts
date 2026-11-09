import { describe, expect, it } from "vitest";
import { renderSurface } from "../../../__tests__/render";
import { guardNumericFilter, guardStyleFilters } from "../index";
import { buttons, ui } from "./helpers";

describe("Map", () => {
  it("shows a list of places when maplibre-gl is not provided, and a pick writes the bound path", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Map",
          markers: [
            { label: "Vienna", lat: 48.2, lng: 16.37 },
            { label: "Graz", lat: 47.07, lng: 15.44, category: "City" },
          ],
          selected: { "@path": "/city" },
        },
      ],
      { city: "Vienna" },
    );
    expect(
      view.container.querySelector('[data-a2ui-map="fallback"]'),
    ).not.toBeNull();
    const places = view.container.querySelector('[aria-label="Map places"]')!;
    expect(places.hasAttribute("data-collapsed")).toBe(false);
    const [vienna, graz] = buttons(view);
    expect(vienna!.getAttribute("aria-pressed")).toBe("true");
    expect(graz!.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Graz 47.0700, 15.4400 · City",
    );
    view.act(() => graz!.click());
    expect(view.dataAt("/city")).toBe("Graz");
    expect(graz!.getAttribute("aria-pressed")).toBe("true");
    expect(vienna!.getAttribute("aria-pressed")).toBe("false");
  });

  it("gives the map and its list of places the height in pixels", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Map",
          markers: [{ label: "Vienna", lat: 48.2, lng: 16.37 }],
          height: 300,
        },
      ],
      {},
    );
    const map = view.container.querySelector("[data-a2ui-map]")!;
    const canvasHost = map.querySelector<HTMLElement>("[aria-hidden]")!;
    expect(canvasHost.style.height).toBe("300px");
    const places = map.querySelector<HTMLElement>('[aria-label="Map places"]')!;
    expect(places.style.maxHeight).toBe("300px");
  });
});

describe("map style filter guard", () => {
  it("guards numeric property comparisons with a has check, at any depth", () => {
    expect(guardNumericFilter([">=", ["get", "ref_length"], 2])).toEqual([
      "all",
      ["has", "ref_length"],
      [">=", ["get", "ref_length"], 2],
    ]);
    expect(
      guardNumericFilter([
        "all",
        ["==", "class", "road"],
        ["<", ["get", "rank"], 3],
      ]),
    ).toEqual([
      "all",
      ["==", "class", "road"],
      ["all", ["has", "rank"], ["<", ["get", "rank"], 3]],
    ]);
  });

  it("leaves comparisons that do not compare a property with a number", () => {
    expect(guardNumericFilter(["==", ["get", "class"], "road"])).toEqual([
      "==",
      ["get", "class"],
      "road",
    ]);
    expect(guardNumericFilter([">", ["zoom"], 3])).toEqual([">", ["zoom"], 3]);
  });

  it("guards the filter of each style layer and keeps layers without one", () => {
    const style = {
      layers: [{ id: "a", filter: [">", ["get", "n"], 1] }, { id: "b" }],
    };
    expect(guardStyleFilters(style)).toEqual({
      layers: [
        { id: "a", filter: ["all", ["has", "n"], [">", ["get", "n"], 1]] },
        { id: "b" },
      ],
    });
  });
});
