import { describe, expect, it } from "vitest";

import { commitShaFromEnvironment } from "./ci-environment.js";

describe("CI environment", () => {
  it("prefers the checked-out commit over GitHub's workflow SHA", () => {
    expect(
      commitShaFromEnvironment({
        CHECKOUT_SHA: "pull-request-head",
        GITHUB_SHA: "synthetic-merge",
      }),
    ).toBe("pull-request-head");
  });

  it("falls back safely outside the exact-checkout workflow", () => {
    expect(commitShaFromEnvironment({ GITHUB_SHA: "push-head" })).toBe(
      "push-head",
    );
    expect(commitShaFromEnvironment({})).toBe("local");
  });
});
