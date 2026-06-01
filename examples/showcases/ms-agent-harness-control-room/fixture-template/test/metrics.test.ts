import { describe, expect, it } from "vitest";

import { parseRevenueCsv, summarizeRevenue } from "../src/metrics.js";

describe("metrics helpers", () => {
  it("parses revenue CSV rows", () => {
    const rows = parseRevenueCsv(
      "month,product,revenue,users,region\nJan,Core,12000,220,NA\nFeb,Teams,9000,160,EU",
    );

    expect(rows).toEqual([
      {
        month: "Jan",
        product: "Core",
        revenue: 12000,
        users: 220,
        region: "NA",
      },
      {
        month: "Feb",
        product: "Teams",
        revenue: 9000,
        users: 160,
        region: "EU",
      },
    ]);
  });

  it("summarizes revenue totals", () => {
    const rows = parseRevenueCsv(
      [
        "month,product,revenue,users,region",
        "Jan,Core,12000,220,NA",
        "Feb,Teams,9000,160,EU",
        "Mar,Core,15000,260,NA",
      ].join("\n"),
    );

    expect(summarizeRevenue(rows)).toEqual({
      totalRevenue: 36000,
      totalUsers: 640,
      averageRevenuePerUser: 56.25,
      topProduct: "Core",
      regions: ["EU", "NA"],
    });
  });
});
