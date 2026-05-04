// showcase/integrations/nextjs/src/registry/__tests__/frameworks.test.ts
import { describe, it, expect } from "vitest";
import { frameworks, isReachable } from "../frameworks";

describe("frameworks registry", () => {
  it("exports a registry with frameworks configured", () => {
    expect(Object.keys(frameworks).length).toBeGreaterThan(0);
  });

  it("isReachable false for empty backendUrl", () => {
    expect(isReachable({ slug: "x", name: "X", language: "python", backendUrl: "" })).toBe(false);
  });

  it("isReachable true for non-empty backendUrl", () => {
    expect(isReachable({ slug: "x", name: "X", language: "python", backendUrl: "http://localhost:8000" })).toBe(true);
  });
});

describe("strands entry", () => {
  it("strands has slug, name, language", () => {
    expect(frameworks.strands).toBeDefined();
    expect(frameworks.strands.slug).toBe("strands");
    expect(frameworks.strands.name).toBe("AWS Strands");
    expect(frameworks.strands.language).toBe("python");
  });
});
