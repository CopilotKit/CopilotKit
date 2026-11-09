import { afterEach, describe, expect, it, vi } from "vitest";
import { defined, layoutStyle, px, radiusStyle } from "../style-helpers";
import { faviconSrc, hostOf, openUrl, safeHref } from "../url";
import {
  chartConfig,
  makeFormatter,
  normalizeSeries,
  resolveCssColor,
  withAlpha,
} from "../chart-config";
import {
  guardNumericFilter,
  guardStyleFilters,
  isMapLibre,
  isValidMarker,
} from "../map-helpers";

/**
 * The shared tests run in node, which has no DOM. The chart helpers only
 * pass the element to `getComputedStyle`, which these tests stub or leave
 * out, so an empty object stands in for it.
 */
function stubElement() {
  return {} as Element;
}

/** Stubs `getComputedStyle` with fixed custom property values. */
function stubCustomProperties(values: Record<string, string>) {
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (name: string) => values[name] ?? "",
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("layoutStyle", () => {
  it("maps the layout props to flex container CSS and leaves out unset props", () => {
    const style = layoutStyle({
      align: "center",
      justify: "spaceBetween",
      padding: 2,
    });
    expect(style).toEqual({
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "calc(var(--spacing, 0.25rem) * 2)",
      minWidth: 0,
      maxWidth: "100%",
      boxSizing: "border-box",
    });
  });

  it("removes the padding for flush and sets overflow for scrollable and clip", () => {
    expect(layoutStyle({ padding: 4, flush: true })).toMatchObject({
      padding: 0,
    });
    expect(layoutStyle({ scrollable: true, clip: true })).toMatchObject({
      overflow: "auto",
    });
    expect(layoutStyle({ clip: true })).toMatchObject({ overflow: "hidden" });
  });

  it("lets rowGap and columnGap win over gap, with no shorthand to override them", () => {
    // A renderer can apply a style object in sorted key order, so a `gap`
    // next to `columnGap` would be written last and erase it.
    const both = layoutStyle({ gap: 2, columnGap: 6 });
    expect(both).toMatchObject({
      rowGap: "calc(var(--spacing, 0.25rem) * 2)",
      columnGap: "calc(var(--spacing, 0.25rem) * 6)",
    });
    expect(both).not.toHaveProperty("gap");
    const rowOnly = layoutStyle({ rowGap: 1 });
    expect(rowOnly).toMatchObject({
      rowGap: "calc(var(--spacing, 0.25rem) * 1)",
    });
    expect(rowOnly).not.toHaveProperty("columnGap");
  });

  it("keeps the gap shorthand when no longhand is set", () => {
    expect(layoutStyle({ gap: 3 })).toMatchObject({
      gap: "calc(var(--spacing, 0.25rem) * 3)",
    });
    expect(layoutStyle({ disableAutoSpacing: true })).toMatchObject({ gap: 0 });
    expect(layoutStyle({})).not.toHaveProperty("gap");
  });
});

describe("radiusStyle", () => {
  it("gives one border radius for a token or a number", () => {
    expect(radiusStyle("lg")).toEqual({
      borderRadius: "var(--a2ui-radius-lg, 12px)",
    });
    expect(radiusStyle(8)).toEqual({ borderRadius: "8px" });
  });

  it("gives one radius for each corner of a corner object", () => {
    expect(
      radiusStyle({
        topLeft: "lg",
        topRight: "2px",
        bottomLeft: "full",
        bottomRight: "0",
      }),
    ).toEqual({
      borderTopLeftRadius: "var(--a2ui-radius-lg, 12px)",
      borderTopRightRadius: "2px",
      borderBottomLeftRadius: "9999px",
      borderBottomRightRadius: "0",
    });
  });

  it("gives no CSS when the radius is not set", () => {
    expect(radiusStyle(undefined)).toEqual({});
  });
});

describe("px and defined", () => {
  it("gives pixels for a number and passes a string through", () => {
    expect(px(12)).toBe("12px");
    expect(px("1rem")).toBe("1rem");
    expect(px(undefined)).toBeUndefined();
  });

  it("drops undefined entries and keeps zero", () => {
    expect(defined({ margin: 0, padding: undefined, color: "red" })).toEqual({
      margin: 0,
      color: "red",
    });
  });
});

describe("safeHref", () => {
  it.each([
    [" https://example.com/a ", "https://example.com/a"],
    ["http://example.com", "http://example.com"],
    ["HTTPS://EXAMPLE.COM", "HTTPS://EXAMPLE.COM"],
    ["mailto:team@example.com", "mailto:team@example.com"],
  ])("accepts %s", (url, expected) => {
    expect(safeHref(url)).toBe(expected);
  });

  it.each(["javascript:alert(1)", " data:text/html,hi", "/relative/path"])(
    "rejects %s",
    (url) => {
      expect(safeHref(url)).toBeUndefined();
    },
  );
});

describe("hostOf and faviconSrc", () => {
  it("reads the host of a URL with or without a scheme", () => {
    expect(hostOf("https://docs.example.com/page?q=1")).toBe(
      "docs.example.com",
    );
    expect(hostOf("example.com/page")).toBe("example.com");
  });

  it("gives undefined for text that is not a URL", () => {
    expect(hostOf("")).toBeUndefined();
    expect(hostOf("http://")).toBeUndefined();
  });

  it("builds the favicon URL with the host encoded", () => {
    expect(faviconSrc("a b.com")).toBe(
      "https://www.google.com/s2/favicons?domain=a%20b.com&sz=64",
    );
  });
});

describe("openUrl", () => {
  it("opens a safe URL in a new tab without an opener", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    openUrl(" https://example.com ");
    expect(open).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("ignores an unsafe scheme", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    openUrl("javascript:alert(1)");
    expect(open).not.toHaveBeenCalled();
  });

  it("does nothing on the server, where there is no window", () => {
    expect(() => openUrl("https://example.com")).not.toThrow();
  });
});

describe("chartConfig", () => {
  it("maps a bar chart to chart.js labels, datasets and colors", () => {
    const config = chartConfig(
      {
        xKey: "month",
        data: [
          { month: "Jan", cost: 290 },
          { month: "Feb", cost: 580 },
        ],
        series: [{ key: "cost", label: "Monthly cost" }],
      },
      stubElement(),
    );
    expect(config).toMatchObject({
      type: "bar",
      data: {
        labels: ["Jan", "Feb"],
        datasets: [
          {
            label: "Monthly cost",
            data: [290, 580],
            // Without a computed style, a color token falls back to its default.
            backgroundColor: "#7fb0f2",
            borderRadius: 4,
          },
        ],
      },
      options: { indexAxis: "x" },
    });
    expect(config.plugins).toBeUndefined();
  });

  it("maps a pie chart to one dataset with a palette color for each slice", () => {
    const config = chartConfig(
      {
        chartType: "pie",
        xKey: "name",
        data: [
          { name: "A", share: 0.6 },
          { name: "B", share: 0.4 },
        ],
      },
      stubElement(),
    );
    expect(config).toMatchObject({
      type: "pie",
      data: {
        labels: ["A", "B"],
        datasets: [
          {
            label: "share",
            data: [0.6, 0.4],
            backgroundColor: ["#7fb0f2", "#2f6fd1"],
          },
        ],
      },
      options: { cutout: 0, radius: "80%", circumference: 360 },
    });
  });

  it("paints with the color that the element's custom property sets", () => {
    stubCustomProperties({ "--a2ui-chart-1": "#ff0000" });
    const config = chartConfig(
      { xKey: "q", data: [{ q: "Q1", a: 1 }] },
      stubElement(),
    );
    expect(config).toMatchObject({
      data: { datasets: [{ backgroundColor: "#ff0000" }] },
    });
  });

  it("adds the value labels plugin only when showValueLabels is set", () => {
    const config = chartConfig(
      { xKey: "q", data: [{ q: "Q1", a: 1 }], showValueLabels: true },
      stubElement(),
    );
    expect(config).toMatchObject({ plugins: [{ id: "a2uiValueLabels" }] });
  });
});

describe("normalizeSeries", () => {
  it("charts every number field except the x key when no series is set", () => {
    expect(
      normalizeSeries(
        undefined,
        [{ day: "Mon", food: 3, rent: 10, note: "x" }],
        "day",
      ),
    ).toEqual([
      { key: "food", label: "food", color: "var(--a2ui-chart-1, #7fb0f2)" },
      { key: "rent", label: "rent", color: "var(--a2ui-chart-2, #2f6fd1)" },
    ]);
  });
});

describe("makeFormatter", () => {
  it("gives no formatter when no format is set", () => {
    expect(makeFormatter(undefined, undefined)).toBeUndefined();
  });

  it("formats currency in USD by default, compact from 10,000", () => {
    const format = makeFormatter("currency", undefined)!;
    expect(format(290)).toBe("$290");
    expect(format(16_000)).toBe("$16K");
  });

  it("formats a fraction as a percentage and uses the requested currency", () => {
    expect(makeFormatter("percent", undefined)!(0.25)).toBe("25%");
    expect(makeFormatter("currency", "EUR")!(40)).toBe("€40");
  });

  it("falls back to plain numbers for an unknown currency code", () => {
    expect(makeFormatter("currency", "not-a-code")!(1290)).toBe("1,290");
  });

  it("prints a value that is not a number as text", () => {
    const format = makeFormatter("number", undefined)!;
    expect(format("n/a")).toBe("n/a");
    expect(format(null)).toBe("");
  });
});

describe("resolveCssColor and withAlpha", () => {
  it("reads a var() token from the computed style, else its fallback", () => {
    stubCustomProperties({ "--brand": "#123456" });
    expect(resolveCssColor("var(--brand, #000000)", stubElement())).toBe(
      "#123456",
    );
    expect(resolveCssColor("var(--unset, #abcdef)", stubElement())).toBe(
      "#abcdef",
    );
  });

  it("passes a plain color through", () => {
    expect(resolveCssColor("rebeccapurple", stubElement())).toBe(
      "rebeccapurple",
    );
  });

  it("adds an alpha channel to a #rrggbb color only", () => {
    expect(withAlpha("#ff0000", 0.2)).toBe("#ff000033");
    expect(withAlpha("red", 0.2)).toBe("red");
  });
});

describe("guardNumericFilter and guardStyleFilters", () => {
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

  it("returns a style without layers as it is", () => {
    const style: { version: number; layers?: object[] } = { version: 8 };
    expect(guardStyleFilters(style)).toBe(style);
  });
});

describe("isValidMarker and isMapLibre", () => {
  it("accepts a marker with finite coordinates only", () => {
    expect(isValidMarker({ label: "Vienna", lat: 48.2, lng: 16.37 })).toBe(
      true,
    );
    expect(isValidMarker({ label: "Nowhere", lat: Number.NaN, lng: 0 })).toBe(
      false,
    );
    expect(
      isValidMarker({ label: "Far", lat: 0, lng: Number.POSITIVE_INFINITY }),
    ).toBe(false);
  });

  it("recognizes a module with a Map constructor", () => {
    expect(isMapLibre({ Map: class {} })).toBe(true);
    expect(isMapLibre({ Map: "not a constructor" })).toBe(false);
    expect(isMapLibre(null)).toBe(false);
  });
});
