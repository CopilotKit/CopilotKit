import { describe, expect, it } from "vitest";
import { stripRouteGroupSegmentsFromPathname } from "../route-groups";

describe("stripRouteGroupSegmentsFromPathname", () => {
  it("removes route groups from public paths", () => {
    expect(
      stripRouteGroupSegmentsFromPathname("/strands/(other)/telemetry"),
    ).toBe("/strands/telemetry");
  });

  it("keeps non-route-group paths unchanged", () => {
    expect(stripRouteGroupSegmentsFromPathname("/strands/telemetry")).toBe(
      "/strands/telemetry",
    );
  });
});
