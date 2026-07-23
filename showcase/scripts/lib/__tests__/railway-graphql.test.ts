import { describe, expect, it } from "vitest";
import { RAILWAY_GRAPHQL_ENDPOINT } from "../railway-graphql";

describe("railway-graphql", () => {
  it("uses the canonical backboard.railway.app host", () => {
    expect(RAILWAY_GRAPHQL_ENDPOINT).toBe(
      "https://backboard.railway.app/graphql/v2",
    );
  });

  it("never resolves to the .com host (historical drift target)", () => {
    expect(RAILWAY_GRAPHQL_ENDPOINT).not.toContain("backboard.railway.com");
  });
});
