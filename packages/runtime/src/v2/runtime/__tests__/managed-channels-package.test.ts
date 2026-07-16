import { describe, expect, it } from "vitest";
import runtimePackage from "../../../../package.json";

describe("managed Channels package metadata", () => {
  it("auto-installs the managed Channels activation module", () => {
    expect(runtimePackage.dependencies).toMatchObject({
      "@copilotkit/channels-intelligence": "workspace:*",
    });
    expect(runtimePackage.peerDependencies).not.toHaveProperty(
      "@copilotkit/channels-intelligence",
    );
  });
});
