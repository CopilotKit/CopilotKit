import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveUserId } from "./user-id";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveUserId", () => {
  it("uses the pinned INTELLIGENCE_USER_ID when set", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "jordan-beamson");
    expect(resolveUserId("Admin")).toBe("jordan-beamson");
  });

  it("derives a stable per-role id when not pinned", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(resolveUserId("Marketing Assistant")).toBe(
      "northwind-marketing-assistant",
    );
  });

  it("falls back to a single demo id when no role is given", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(resolveUserId(undefined)).toBe("northwind-demo-user");
  });
});
