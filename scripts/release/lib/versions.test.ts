import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseSemver,
  computeNextStableVersion,
  computePrereleaseVersion,
} from "./versions.js";

// Mock loadConfig for computePrereleaseVersion
vi.mock("./config.js", () => ({
  ROOT: "/mock",
  loadConfig: () => ({
    prereleaseTag: "canary",
    versionedTogether: [],
    versionedIndependently: [],
  }),
}));

describe("parseSemver", () => {
  it("parses a stable version", () => {
    expect(parseSemver("1.55.2")).toEqual({
      major: 1,
      minor: 55,
      patch: 2,
      prerelease: null,
    });
  });

  it("parses a prerelease version", () => {
    expect(parseSemver("1.55.2-canary.1744382400")).toEqual({
      major: 1,
      minor: 55,
      patch: 2,
      prerelease: "canary.1744382400",
    });
  });

  it("parses a version with text prerelease", () => {
    expect(parseSemver("2.0.0-canary.fix-user-issue")).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      prerelease: "canary.fix-user-issue",
    });
  });

  it("throws on invalid version", () => {
    expect(() => parseSemver("not-a-version")).toThrow("Invalid semver");
  });

  it("throws on empty string", () => {
    expect(() => parseSemver("")).toThrow("Invalid semver");
  });
});

describe("computeNextStableVersion", () => {
  it("bumps patch", () => {
    expect(computeNextStableVersion("1.55.2", "patch")).toBe("1.55.3");
  });

  it("bumps minor", () => {
    expect(computeNextStableVersion("1.55.2", "minor")).toBe("1.56.0");
  });

  it("bumps major", () => {
    expect(computeNextStableVersion("1.55.2", "major")).toBe("2.0.0");
  });

  it("strips prerelease suffix on any bump", () => {
    expect(computeNextStableVersion("1.56.0-canary.123", "patch")).toBe(
      "1.56.0",
    );
  });

  it("strips prerelease suffix regardless of bump level", () => {
    expect(computeNextStableVersion("2.0.0-canary.123", "major")).toBe("2.0.0");
  });

  it("handles 0.x versions", () => {
    expect(computeNextStableVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(computeNextStableVersion("0.1.0", "minor")).toBe("0.2.0");
    expect(computeNextStableVersion("0.1.0", "major")).toBe("1.0.0");
  });
});

describe("computePrereleaseVersion", () => {
  it("appends canary tag with timestamp when no suffix given", () => {
    const result = computePrereleaseVersion("1.55.2");
    expect(result).toMatch(/^1\.55\.2-canary\.\d+$/);
  });

  it("appends canary tag with custom suffix", () => {
    expect(computePrereleaseVersion("1.55.2", "fix-user-issue")).toBe(
      "1.55.2-canary.fix-user-issue",
    );
  });

  it("uses the base version as-is (no bump)", () => {
    expect(computePrereleaseVersion("1.55.2", "test")).toBe(
      "1.55.2-canary.test",
    );
    expect(computePrereleaseVersion("2.0.0", "test")).toBe("2.0.0-canary.test");
  });

  it("strips existing prerelease before appending", () => {
    expect(computePrereleaseVersion("1.55.2-canary.old", "new")).toBe(
      "1.55.2-canary.new",
    );
  });
});
