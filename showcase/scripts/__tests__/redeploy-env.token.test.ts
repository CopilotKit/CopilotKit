import { describe, expect, it, vi } from "vitest";
import { resolveRailwayTokenFromConfig } from "../lib/railway-token";

// Characterization test: pins the resolver contract that redeploy-env's
// getToken path will use after E-2d. The resolver itself was proven
// red-green in E-2a/E-2b; this test exists so a future change to the
// resolver that breaks the redeploy-env consumer surfaces here too.
// EXPECTED OUTCOME: PASS on first run (resolver already exists). This is
// intentional — see the step header. Do NOT relabel this as a RED step.
describe("redeploy-env token resolution contract", () => {
  it("returns accessToken from a typical post-login config", () => {
    const warn = vi.fn();
    expect(
      resolveRailwayTokenFromConfig(
        { user: { accessToken: "abc-access-aaaaaaaaaaaaa" } },
        { warn },
      ),
    ).toBe("abc-access-aaaaaaaaaaaaa");
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when only user.token (legacy) is present", () => {
    const warn = vi.fn();
    expect(
      resolveRailwayTokenFromConfig(
        { user: { token: "legacy-xxxxxxxxxx" } },
        { warn },
      ),
    ).toBe("legacy-xxxxxxxxxx");
    expect(warn).toHaveBeenCalledOnce();
  });
});
