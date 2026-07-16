import { describe, expect, it } from "vitest";
import { getScopeConfig } from "./config.js";
import { getPackagesForScope } from "./versions.js";
import { FAMILY as CHANNELS_PACKAGES } from "./channels-umbrella.js";

describe("Channels release scope", () => {
  it("publishes the complete Channels family from one shared scope", () => {
    expect(getScopeConfig("channels")).toEqual({
      packages: CHANNELS_PACKAGES,
      versionSource: "@copilotkit/channels",
      sharedVersion: true,
    });
  });

  it("resolves Channels packages in configured publish order", () => {
    expect(getPackagesForScope("channels").map((pkg) => pkg.name)).toEqual(
      CHANNELS_PACKAGES,
    );
  });
});
