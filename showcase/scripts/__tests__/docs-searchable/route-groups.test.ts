import { describe, expect, it } from "vitest";

// Before lib/docs-searchable: it reads shell-docs relative to the cwd.
import "./shell-docs-cwd";
import { stripRouteGroupSegmentsFromPathname } from "../../lib/docs-searchable/route-groups";

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
