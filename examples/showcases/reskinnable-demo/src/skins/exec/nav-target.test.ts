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
        period: "2024-06",
        top: 5,
        threshold: true,
      }),
    ).toBe("metrics?department=distribution&period=2024-06&top=5&threshold=1");
  });

  /**
   * THE `period` LEVER, ROUND-TRIPPED. Every other lever had an assertion that
   * reads its key back out of the query string; `period` had none — the only
   * test that passed one asserted the result is not `/exec`-prefixed, which
   * holds whether or not the key is written at all. Deleting
   * `params.set("period", period)` kept this suite green.
   */
  it("round-trips period into the query string", () => {
    expect(execNavTarget({ segment: "metrics", period: "2024-06" })).toBe(
      "metrics?period=2024-06",
    );
    expect(
      new URLSearchParams(
        execNavTarget({ segment: "metrics", period: "2024-06" }).split("?")[1],
      ).get("period"),
    ).toBe("2024-06");
  });

  it("omits period when unset or empty rather than defaulting it", () => {
    expect(execNavTarget({ segment: "metrics" })).not.toContain("period");
    expect(execNavTarget({ segment: "metrics", period: "" })).toBe("metrics");
    expect(
      execNavTarget({ segment: "metrics", department: "distribution" }),
    ).not.toContain("period");
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
