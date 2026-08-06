import { describe, it, expect, afterEach } from "vitest";
import {
  logisticsIdentifyUser,
  resolveUserId,
  resolveUserName,
  DEMO_DEFAULT_USER_ID,
} from "./user-id";

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("logistics identity", () => {
  it("maps a known planner id onto a stable scope", () => {
    expect(resolveUserId({ plannerId: "pl-rosa" })).toBe("rosa-delgado");
    expect(resolveUserName({ plannerId: "pl-rosa" })).toBe("Rosa Delgado");
  });

  it("keeps the two planners in separate memory scopes", () => {
    expect(resolveUserId({ plannerId: "pl-rosa" })).not.toBe(
      resolveUserId({ plannerId: "pl-ibrahim" }),
    );
  });

  it("falls back to a role-derived scope for an unmapped planner", () => {
    expect(resolveUserId({ plannerId: "pl-unknown", role: "Director" })).toBe(
      "meridian-director",
    );
  });

  it("falls back to the demo default with no planner and no role", () => {
    expect(resolveUserId({})).toBe(DEMO_DEFAULT_USER_ID);
  });

  it("lets a pinned env id win so CI stays deterministic", () => {
    process.env.INTELLIGENCE_USER_ID = "ci-pinned";
    process.env.INTELLIGENCE_USER_NAME = "CI User";
    expect(resolveUserId({ plannerId: "pl-rosa" })).toBe("ci-pinned");
    expect(resolveUserName({ plannerId: "pl-rosa" })).toBe("CI User");
  });

  it("reads the client-forwarded properties bag", () => {
    expect(
      logisticsIdentifyUser({ userId: "pl-ibrahim", userRole: "Director" }),
    ).toEqual({ id: "ibrahim-okonjo", name: "Ibrahim Okonjo" });
    expect(logisticsIdentifyUser(undefined).id).toBe(DEMO_DEFAULT_USER_ID);
  });
});
