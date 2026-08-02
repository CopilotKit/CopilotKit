import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveKeelUserId,
  resolveKeelUserName,
  keelIdentifyUser,
} from "./user-id";

// Two of the four seeded personas (see data/personas.ts).
const ANA = "ana-reyes"; // Ana Reyes, Nurse Manager
const SAM = "sam-okafor"; // Sam Okafor, Privacy Officer

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveKeelUserId", () => {
  it("pin wins over everything (CI determinism)", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "pinned-scope");
    expect(
      resolveKeelUserId({ userId: SAM, userRole: "Privacy Officer" }),
    ).toBe("pinned-scope");
  });

  it("scopes a known persona id to keel-<id> when unpinned", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(resolveKeelUserId({ userId: ANA })).toBe("keel-ana-reyes");
    expect(resolveKeelUserId({ userId: SAM })).toBe("keel-sam-okafor");
  });

  it("falls back to a role-derived scope for an unmapped persona id", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(
      resolveKeelUserId({ userId: "nobody", userRole: "Privacy Officer" }),
    ).toBe("keel-privacy-officer");
  });

  it("falls back to a demo scope when nothing is given", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(resolveKeelUserId({})).toBe("keel-demo-user");
  });
});

describe("resolveKeelUserName", () => {
  it("returns the mapped persona display name when unpinned", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(resolveKeelUserName({ userId: SAM })).toBe("Sam Okafor");
  });

  it("honors the pinned name env when set", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "pinned-scope");
    vi.stubEnv("INTELLIGENCE_USER_NAME", "Pinned User");
    expect(resolveKeelUserName({ userId: ANA })).toBe("Pinned User");
  });

  it("derives a role name when the persona id is unmapped", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(resolveKeelUserName({ userRole: "Privacy Officer" })).toBe(
      "Keel Privacy Officer",
    );
  });
});

describe("keelIdentifyUser", () => {
  it("composes id + name from the forwarded run properties", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(
      keelIdentifyUser({ userId: SAM, userRole: "Privacy Officer" }),
    ).toEqual({ id: "keel-sam-okafor", name: "Sam Okafor" });
  });

  it("handles undefined properties with the demo identity", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(keelIdentifyUser(undefined)).toEqual({
      id: "keel-demo-user",
      name: "Keel Demo User",
    });
  });
});
