import { describe, expect, it } from "vitest";

import {
  DEFAULT_LAYOUT_PREFERENCES,
  parseLayoutPreferences,
  serializeLayoutPreferences,
} from "@/shell/layout/layout-preferences-storage";

describe("parseLayoutPreferences", () => {
  it("returns defaults for a missing value", () => {
    expect(parseLayoutPreferences(null)).toEqual(DEFAULT_LAYOUT_PREFERENCES);
  });

  it("returns defaults for malformed JSON rather than throwing", () => {
    expect(parseLayoutPreferences("{not json")).toEqual(
      DEFAULT_LAYOUT_PREFERENCES,
    );
  });

  it("returns defaults for a JSON value that is not an object", () => {
    expect(parseLayoutPreferences('"left"')).toEqual(
      DEFAULT_LAYOUT_PREFERENCES,
    );
    expect(parseLayoutPreferences("null")).toEqual(DEFAULT_LAYOUT_PREFERENCES);
  });

  it("defaults an unrecognised side to left", () => {
    expect(
      parseLayoutPreferences('{"sidebarSide":"sideways"}').sidebarSide,
    ).toBe("left");
  });

  it("honours an explicit right side", () => {
    expect(parseLayoutPreferences('{"sidebarSide":"right"}').sidebarSide).toBe(
      "right",
    );
  });

  it("honours an explicitly closed sidebar", () => {
    expect(parseLayoutPreferences('{"sidebarOpen":false}').sidebarOpen).toBe(
      false,
    );
  });

  it("defaults the sidebar to open when the key is absent", () => {
    expect(parseLayoutPreferences("{}").sidebarOpen).toBe(true);
  });

  it("round-trips through serialize", () => {
    const value = { sidebarSide: "right", sidebarOpen: false } as const;
    expect(parseLayoutPreferences(serializeLayoutPreferences(value))).toEqual(
      value,
    );
  });
});
