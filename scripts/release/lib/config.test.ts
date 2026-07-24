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

  it("resolves Channels packages in configured publish order", () => {
    expect(getPackagesForScope("channels").map((pkg) => pkg.name)).toEqual(
      CHANNELS_PACKAGES,
    );
  });
});

describe("Intelligence release scope", () => {
  it("is an independent one-package scope", () => {
    expect(getScopeConfig("intelligence")).toEqual({
      packages: ["@copilotkit/intelligence"],
      versionSource: "@copilotkit/intelligence",
      sharedVersion: false,
    });
  });

  // @copilotkit/intelligence is the cross-language contracts SDK: its Python
  // (copilotkit.intelligence) and .NET (CopilotKit.Intelligence) siblings each
  // version independently, and @copilotkit/intelligence-langgraph declares a
  // 0.x peer range against it. Folding it into the shared-version `monorepo`
  // scope would force it to the react-core version on its first publish and
  // instantly invalidate that peer range.
  it("is not enrolled in the shared-version monorepo scope", () => {
    expect(getScopeConfig("monorepo").packages).not.toContain(
      "@copilotkit/intelligence",
    );
  });
});

describe("Intelligence LangGraph release scope", () => {
  it("is an independent one-package scope", () => {
    expect(getScopeConfig("intelligence-langgraph")).toEqual({
      packages: ["@copilotkit/intelligence-langgraph"],
      versionSource: "@copilotkit/intelligence-langgraph",
      sharedVersion: false,
    });
  });
});
