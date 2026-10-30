import { describe, expect, test } from "vitest";
import { ChartPalette } from "@cloudflare/kumo";
import { kumoThemeValues } from "../theme";

describe("kumoThemeValues", () => {
  test("chart series use the Kumo categorical palette", () => {
    for (const series of [1, 2, 3, 4, 5, 6] as const) {
      expect(kumoThemeValues[`--a2ui-chart-${series}`]).toBe(
        ChartPalette.categorical(series - 1, false),
      );
    }
  });

  test("colors reference Kumo tokens", () => {
    const colors = Object.entries(kumoThemeValues).filter(([name]) =>
      name.startsWith("--a2ui-color-"),
    );
    expect(colors.length).toBeGreaterThan(50);
    for (const [name, value] of colors) {
      expect(value, name).toMatch(/var\(--(text-)?color-kumo-/);
    }
  });
});
