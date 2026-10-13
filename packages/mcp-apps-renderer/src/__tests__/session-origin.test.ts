import { describe, expect, it, vi } from "vitest";

import { denyDangerousSchemes } from "../session";

// Mock window.location.origin for relative URL resolution
Object.defineProperty(window, "location", {
  value: { origin: "https://host.example", href: "https://host.example/page" },
  writable: true,
});

describe("denyDangerousSchemes origin check", () => {
  it("rejects /\\ prefix that resolves to a foreign origin", () => {
    // "/\evil.com" — some browsers normalise /\ to // making evil.com the host
    const result = denyDangerousSchemes("/\\evil.com");
    // Should be rejected: either undefined (blocked) or same-origin only
    if (result !== undefined) {
      const parsed = new URL(result);
      expect(parsed.origin).toBe("https://host.example");
    }
  });

  it("allows genuine path-relative URLs on the same origin", () => {
    const result = denyDangerousSchemes("/settings/page");
    expect(result).toBeDefined();
    const parsed = new URL(result!, "https://host.example");
    expect(parsed.origin).toBe("https://host.example");
  });

  it("blocks javascript: scheme", () => {
    expect(denyDangerousSchemes("javascript:alert(1)")).toBeUndefined();
  });

  it("allows https: URLs as written", () => {
    const result = denyDangerousSchemes("https://example.com/page");
    expect(result).toBe("https://example.com/page");
  });
});
