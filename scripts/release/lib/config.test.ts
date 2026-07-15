import { describe, expect, it } from "vitest";
import { getScopeConfig } from "./config.js";
import { getPackagesForScope } from "./versions.js";

const CHANNELS_PACKAGES = [
  "@copilotkit/channels-ui",
  "@copilotkit/channels-core",
  "@copilotkit/channels-slack",
  "@copilotkit/channels-teams",
  "@copilotkit/channels-intelligence",
  "@copilotkit/channels-discord",
  "@copilotkit/channels-telegram",
  "@copilotkit/channels-whatsapp",
  "@copilotkit/channels",
];

describe("Channels release scope", () => {
  it("publishes the complete Channels family from one shared scope", () => {
    expect(getScopeConfig("channels")).toEqual({
      packages: CHANNELS_PACKAGES,
      versionSource: "@copilotkit/channels",
      sharedVersion: true,
    });
  });

  it("resolves every Channels package for a shared-version release", () => {
    expect(getPackagesForScope("channels").map((pkg) => pkg.name)).toEqual(
      CHANNELS_PACKAGES,
    );
  });
});
