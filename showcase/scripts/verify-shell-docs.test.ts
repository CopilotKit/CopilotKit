import { describe, it, expect } from "vitest";
import { runBuildCheck } from "./verify-shell-docs.js";

describe("runBuildCheck", () => {
  it("returns a result with name, status, and messages", () => {
    const result = runBuildCheck({ skipExecution: true });
    expect(result.name).toBe("nx-build-shell-docs");
    expect(["pass", "fail", "skipped"]).toContain(result.status);
    expect(Array.isArray(result.messages)).toBe(true);
  });
});
