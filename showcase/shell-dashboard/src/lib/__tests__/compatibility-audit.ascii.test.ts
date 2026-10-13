// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hasAsciiControl } from "../../../scripts/compatibility-audit/ascii";

describe("compatibility audit ASCII controls", () => {
  const cases: Array<[string, string, boolean]> = [
    ["NUL", "a\u0000b", true],
    ["TAB", "a\u0009b", true],
    ["LF", "a\u000ab", true],
    ["CR", "a\u000db", true],
    ["last C0 control", "a\u001fb", true],
    ["DEL", "a\u007fb", true],
    ["empty string", "", false],
    ["ordinary text", "abc", false],
    ["SPACE", "a b", false],
    ["tilde", "a~b", false],
    ["U+0080", "a\u0080b", false],
    ["U+0085", "a\u0085b", false],
    ["NBSP", "a\u00a0b", false],
    ["line separator", "a\u2028b", false],
    ["paragraph separator", "a\u2029b", false],
    ["non-BMP character", "a\u{1f600}b", false],
  ];

  it.each(cases)("checks %s", (_case, value, expected) => {
    expect(hasAsciiControl(value)).toBe(expected);
  });
});
