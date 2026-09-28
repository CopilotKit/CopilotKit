import { expect, test } from "vitest";
import { intelligenceContentFixture } from "./intelligence-content-fixtures.js";

test("local tool fixture pages retain full-window totals", () => {
  expect(
    intelligenceContentFixture({
      method: "GET",
      path: "/api/v1/tools",
      query: { limit: "1", sort: "calls" },
    }),
  ).toMatchObject({
    data: [{ toolName: "lookup_order" }],
    totals: { tools: 2, calls: 512, errors: 6 },
    nextCursor: "fixture_tools_calls_1",
  });
  expect(
    intelligenceContentFixture({
      method: "GET",
      path: "/api/v1/tools",
      query: { limit: "1", sort: "calls", cursor: "fixture_tools_calls_1" },
    }),
  ).toMatchObject({
    data: [{ toolName: "refund" }],
    totals: { tools: 2, calls: 512, errors: 6 },
    nextCursor: null,
  });
});
