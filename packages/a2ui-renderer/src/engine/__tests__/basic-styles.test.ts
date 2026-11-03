import { describe, expect, it } from "vitest";
import { getDateTimeInputType, mapAlign, mapJustify } from "../../basic-styles";

describe("mapJustify", () => {
  it.each([
    ["center", "center"],
    ["end", "flex-end"],
    ["spaceAround", "space-around"],
    ["spaceBetween", "space-between"],
    ["spaceEvenly", "space-evenly"],
    ["stretch", "stretch"],
    ["start", "flex-start"],
    [undefined, "flex-start"],
  ])("maps %s to %s", (justify, css) => {
    expect(mapJustify(justify)).toBe(css);
  });
});

describe("mapAlign", () => {
  it.each([
    ["start", "flex-start"],
    ["center", "center"],
    ["end", "flex-end"],
    ["stretch", "stretch"],
    [undefined, "stretch"],
  ])("maps %s to %s", (align, css) => {
    expect(mapAlign(align)).toBe(css);
  });
});

describe("getDateTimeInputType", () => {
  it("picks date, time or datetime-local from what is enabled", () => {
    expect(getDateTimeInputType({ enableDate: true })).toBe("date");
    expect(getDateTimeInputType({ enableTime: true })).toBe("time");
    expect(getDateTimeInputType({ enableDate: true, enableTime: true })).toBe(
      "datetime-local",
    );
    expect(getDateTimeInputType({})).toBe("datetime-local");
  });
});
