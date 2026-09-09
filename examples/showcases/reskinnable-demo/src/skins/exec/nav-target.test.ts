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

  /**
   * THE "any" SENTINEL, ON THIS SIDE TOO. `tools.tsx`'s `navigateTo` requires
   * every lever and says "leave this one alone" with `"any"`, mapping it back
   * to `undefined` at the call site (~line 1078). That mapping was the ONLY
   * thing standing between the sentinel and the query string: any other caller
   * — or a single dropped ternary there — emitted `?period=any`, which matches
   * no point and empties the Metrics Explorer under a tinted control. The
   * omission rule this module owns now covers the sentinel itself, so both
   * ends of the URL agree without depending on a caller to remember.
   */
  it("omits the 'any' period sentinel, whatever its case", () => {
    expect(execNavTarget({ segment: "metrics", period: "any" })).toBe(
      "metrics",
    );
    expect(execNavTarget({ segment: "metrics", period: "ANY" })).toBe(
      "metrics",
    );
    expect(execNavTarget({ segment: "metrics", period: " any " })).toBe(
      "metrics",
    );
  });

  it("omits the 'any' department sentinel rather than emitting a dead param", () => {
    expect(execNavTarget({ segment: "metrics", department: "any" })).toBe(
      "metrics",
    );
  });

  it("omits a department outside the Metrics Explorer's vocabulary", () => {
    expect(execNavTarget({ segment: "metrics", department: "bogus" })).toBe(
      "metrics",
    );
    // "all" IS in the vocabulary — company-wide rows — and must survive.
    expect(execNavTarget({ segment: "metrics", department: "all" })).toBe(
      "metrics?department=all",
    );
  });

  /**
   * The same normalization the page reads with (`normalizePeriodLever`,
   * `pages/metric-rows.ts`): a padded period is emitted TRIMMED, and a period
   * that is not a "YYYY-MM" month is omitted rather than written into a URL
   * the Metrics Explorer would then ignore.
   */
  it("trims a padded period and drops a malformed one", () => {
    expect(execNavTarget({ segment: "metrics", period: " 2024-06 " })).toBe(
      "metrics?period=2024-06",
    );
    expect(execNavTarget({ segment: "metrics", period: "q3" })).toBe("metrics");
    expect(execNavTarget({ segment: "metrics", period: "2024-13" })).toBe(
      "metrics",
    );
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
      period: "2024-06",
      top: 5,
      threshold: true,
    });
    expect(out.startsWith("/exec")).toBe(false);
  });

  it("returns an empty string when neither segment nor levers are set", () => {
    expect(execNavTarget({})).toBe("");
  });

  /**
   * THE INDEX SEGMENT'S SHAPE, PINNED. `navigateTo`'s `segment` enum includes
   * `""` (the CEO dashboard), so a levered nav to the index emits a
   * query-only target. The join is NOT this module's to make: it cannot see
   * the base, and prefixing one here would double-apply it (see this file's
   * header). `navigateTo` in `tools.tsx` splits the query off BEFORE calling
   * `skinHref`, so the composed URL reads `/exec?department=distribution`
   * with no bare `?` after a slash. This pins what this side emits so that
   * split has a stable shape to hold onto.
   */
  it("emits a query-only target for the index segment", () => {
    expect(execNavTarget({ department: "distribution" })).toBe(
      "?department=distribution",
    );
    expect(execNavTarget({ segment: "", department: "distribution" })).toBe(
      "?department=distribution",
    );
  });
});
