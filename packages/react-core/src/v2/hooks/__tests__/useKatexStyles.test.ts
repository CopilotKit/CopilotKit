import { describe, it, expect } from "vitest";
import { containsMath } from "../useKatexStyles";

describe("containsMath (KaTeX gating)", () => {
  it("detects inline and block math", () => {
    expect(containsMath("$E = mc^2$")).toBe(true);
    expect(containsMath("$$\\int_0^1 x\\,dx$$")).toBe(true);
    expect(containsMath("text \\(a + b\\) more")).toBe(true);
    expect(containsMath("\\[ x = 1 \\]")).toBe(true);
    expect(containsMath("\\begin{matrix} a \\end{matrix}")).toBe(true);
  });

  it("returns false for plain prose and empty input", () => {
    expect(containsMath("just some normal text")).toBe(false);
    expect(containsMath("a code `block` and **bold**")).toBe(false);
    expect(containsMath("")).toBe(false);
  });

  it("errs toward true on a single isolated $ pair (cheap false positive)", () => {
    // "$5 and $10" trips the detector; loading KaTeX CSS spuriously is cheap,
    // whereas missing real math would render it unformatted.
    expect(containsMath("$5 and $10")).toBe(true);
  });
});
