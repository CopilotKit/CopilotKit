import { describe, it, expect } from "vitest";
import path from "path";
import { validateIntegration } from "../validate-runtime-routes.js";

// A fixture integration under fixtures/route-wiring models the OSS-451 shape:
//   - shipped-ok        (in features) → route exists           → OK
//   - base-route        (in features) → runtimeUrl "/api/copilotkit" exists → OK
//   - shipped-broken    (in features) → route MISSING          → VIOLATION (the OSS-451 bug)
//   - unshipped-broken  (NOT in features) → route MISSING      → skipped (unshipped)
const FIXTURE = path.resolve(__dirname, "fixtures", "route-wiring");

describe("runtime-route wiring validator", () => {
  const violations = validateIntegration(FIXTURE);

  it("flags exactly the shipped demo whose route is missing (the OSS-451 class)", () => {
    expect(violations).toHaveLength(1);
    expect(violations[0].demo).toBe("shipped-broken");
    expect(violations[0].runtimeUrl).toBe("/api/copilotkit-shipped-broken");
    expect(violations[0].integration).toBe("route-wiring");
  });

  it("does NOT flag a shipped demo whose dedicated route exists", () => {
    expect(violations.some((v) => v.demo === "shipped-ok")).toBe(false);
  });

  it("does NOT flag a shipped demo pointing at the shared /api/copilotkit route", () => {
    expect(violations.some((v) => v.demo === "base-route")).toBe(false);
  });

  it("skips unshipped demos (not in manifest features) even when their route is missing", () => {
    // unshipped-broken has a missing route but is intentionally not gated —
    // it is not claimed to work. Promoting it into `features` would start
    // enforcing it, catching the break at that PR.
    expect(violations.some((v) => v.demo === "unshipped-broken")).toBe(false);
  });

  it("emits a stable baseline key for each violation", () => {
    expect(violations[0].key).toBe(
      "route-wiring:shipped-broken:/api/copilotkit-shipped-broken",
    );
  });
});
