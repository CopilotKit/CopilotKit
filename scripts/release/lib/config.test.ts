import { describe, expect, it } from "vitest";
import {
  ALL_SCOPES,
  getScopeConfig,
  loadConfig,
  resolveScopes,
} from "./config.js";
import { getPackagesForScope } from "./versions.js";
import { getScopePathspecs } from "./changes.js";

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
      /Unknown scope: runtime\. Valid scopes: .*intelligence-mastra, all/,
    );
  });

  // "all" is a selector, never a scope: a scope named `all` in
  // release.config.json would make the sentinel ambiguous.
  it("keeps the sentinel out of the configured scope names", () => {
    expect(Object.keys(loadConfig().scopes)).not.toContain(ALL_SCOPES);
  });
});

describe.each(["intelligence-langgraph", "intelligence-mastra"] as const)(
  "%s release scope",
  (scope) => {
    it("releases independently without publishing the private delivery core", () => {
      expect(getScopeConfig(scope)).toEqual({
        packages: [`@copilotkit/${scope}`],
        versionSource: `@copilotkit/${scope}`,
        sharedVersion: false,
        sourcePaths: ["packages/intelligence-delivery-core"],
      });
      expect(getScopeConfig("monorepo").packages).not.toContain(
        `@copilotkit/${scope}`,
      );
      expect(
        Object.values(loadConfig().scopes).flatMap((value) => value.packages),
      ).not.toContain("@copilotkit/intelligence-delivery-core");
    });
    it("includes bundled core changes in release notes without adding a publishable package", () => {
      expect(getScopePathspecs(scope)).toEqual([
        `packages/${scope}`,
        "packages/intelligence-delivery-core",
      ]);
      expect(getPackagesForScope(scope).map((pkg) => pkg.name)).toEqual([
        `@copilotkit/${scope}`,
      ]);
    });
  },
);

it("keeps unrelated scopes limited to their published package paths", () => {
  for (const scope of ["monorepo", "angular", "channels"] as const) {
    expect(getScopePathspecs(scope)).toEqual(
      getScopeConfig(scope).packages.map(
        (name) => `packages/${name.split("/")[1]}`,
      ),
    );
  }
});
