import { describe, expect, it } from "vitest";
import {
  ALL_SCOPES,
  getScopeConfig,
  loadConfig,
  resolveScopes,
} from "./config.js";
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

  it("resolves Channels packages in configured publish order", () => {
    expect(getPackagesForScope("channels").map((pkg) => pkg.name)).toEqual(
      CHANNELS_PACKAGES,
    );
  });
});

describe("resolveScopes", () => {
  it("resolves a single scope to itself", () => {
    expect(resolveScopes("channels")).toEqual(["channels"]);
  });

  it("expands the all sentinel to every configured scope, in config order", () => {
    expect(resolveScopes(ALL_SCOPES)).toEqual(Object.keys(loadConfig().scopes));
  });

  it("rejects an unknown scope and names the valid selectors", () => {
    expect(() => resolveScopes("runtime")).toThrow(
      /Unknown scope: runtime\. Valid scopes: .*channels, all/,
    );
  });

  // "all" is a selector, never a scope: a scope named `all` in
  // release.config.json would make the sentinel ambiguous.
  it("keeps the sentinel out of the configured scope names", () => {
    expect(Object.keys(loadConfig().scopes)).not.toContain(ALL_SCOPES);
  });
});
