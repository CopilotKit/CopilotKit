import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveUserId, resolveUserName, SEEDED_USER_IDS } from "./user-id";

// The two surviving seeded members (see seed.json).
const ALEX = "9g5h2j1k4l"; // Alex Morgan, Admin  -> jordan-beamson
const MAYA = "2b3c4d5e6f"; // Maya Chen,  Assistant -> morgan-fluxx

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveUserId", () => {
  it("pin wins over everything (CI determinism)", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "jordan-beamson");
    expect(resolveUserId({ memberId: MAYA, role: "Assistant" })).toBe(
      "jordan-beamson",
    );
  });

  it("maps a known member id to its seeded backend id when unpinned", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(resolveUserId({ memberId: ALEX })).toBe("jordan-beamson");
    expect(resolveUserId({ memberId: MAYA })).toBe("morgan-fluxx");
  });

  it("falls back to a role-derived id for an unmapped member id", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(resolveUserId({ memberId: "unknown-id", role: "Admin" })).toBe(
      "northwind-admin",
    );
  });

  it("falls back to a demo id when nothing is given", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(resolveUserId({})).toBe("northwind-demo-user");
  });
});

describe("resolveUserName", () => {
  it("returns the mapped member display name when unpinned", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(resolveUserName({ memberId: ALEX })).toBe("Alex Morgan");
  });

  it("honors the pinned name env when set", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "jordan-beamson");
    vi.stubEnv("INTELLIGENCE_USER_NAME", "Jordan Beamson");
    expect(resolveUserName({ memberId: MAYA })).toBe("Jordan Beamson");
  });
});

describe("SEEDED_USER_IDS", () => {
  it("lists exactly the two seeded backend personas", () => {
    expect([...SEEDED_USER_IDS].sort()).toEqual(
      ["jordan-beamson", "morgan-fluxx"].sort(),
    );
  });
});
