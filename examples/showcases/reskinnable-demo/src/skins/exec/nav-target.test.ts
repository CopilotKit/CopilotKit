import { describe, expect, it } from "vitest";
import { execNavTarget } from "./nav-target";

describe("execNavTarget", () => {
  it("returns the bare segment when no levers are set", () => {
    expect(execNavTarget({ segment: "metrics" })).toBe("metrics");
  });

  it("omits unset levers entirely rather than defaulting them", () => {
    expect(
      execNavTarget({ segment: "metrics", department: "distribution" }),
    ).toBe("metrics?department=distribution");
  });

  it("builds the full query when every lever is set", () => {
    expect(
      execNavTarget({
        segment: "metrics",
        department: "distribution",
        top: 5,
        threshold: true,
      }),
    ).toBe("metrics?department=distribution&top=5&threshold=1");
  });

  it("drops a fractional top", () => {
    expect(execNavTarget({ segment: "metrics", top: 2.5 })).toBe("metrics");
  });

  it("drops a negative top", () => {
    expect(execNavTarget({ segment: "metrics", top: -1 })).toBe("metrics");
  });

  it("drops a zero top", () => {
    expect(execNavTarget({ segment: "metrics", top: 0 })).toBe("metrics");
  });

  it("omits threshold when false", () => {
    expect(execNavTarget({ segment: "metrics", threshold: false })).toBe(
      "metrics",
    );
  });

  it("never returns a value prefixed with /exec", () => {
    const out = execNavTarget({
      segment: "metrics",
      department: "distribution",
      period: "q3",
      top: 5,
      threshold: true,
    });
    expect(out.startsWith("/exec")).toBe(false);
  });

  it("returns an empty string when neither segment nor levers are set", () => {
    expect(execNavTarget({})).toBe("");
  });
});
