// showcase/integrations/nextjs/src/registry/__tests__/frameworks.test.ts
import { describe, it, expect } from "vitest";
import { frameworks, isReachable } from "../frameworks";

describe("frameworks registry", () => {
  it("exports an object", () => {
    expect(typeof frameworks).toBe("object");
  });

  it("isReachable false for empty backendUrl", () => {
    expect(isReachable({ slug: "x", name: "X", language: "python", backendUrl: "" })).toBe(false);
  });

  it("isReachable true for non-empty backendUrl", () => {
    expect(isReachable({ slug: "x", name: "X", language: "python", backendUrl: "http://localhost:8000" })).toBe(true);
  });
});
