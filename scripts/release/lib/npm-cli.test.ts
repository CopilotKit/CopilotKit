import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NPM_PUBLISH_VERSION,
  resetPublishNpmCache,
  resolvePublishNpm,
} from "./npm-cli.js";

const spawnSyncMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  spawnSync: spawnSyncMock,
}));

vi.mock("fs", () => ({
  default: {
    mkdtempSync: (prefix: string) => `${prefix}test`,
    existsSync: existsSyncMock,
  },
}));

beforeEach(() => {
  resetPublishNpmCache();
  spawnSyncMock.mockReset();
  existsSyncMock.mockReset();
  existsSyncMock.mockReturnValue(true);
});

describe("resolvePublishNpm", () => {
  it("installs the pinned npm into a throwaway prefix, never mutating the ambient npm", () => {
    spawnSyncMock.mockReturnValue({ status: 0 });

    const bin = resolvePublishNpm();

    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    const [command, args] = spawnSyncMock.mock.calls[0];
    expect(command).toBe("npm");
    expect(args).toContain(`npm@${NPM_PUBLISH_VERSION}`);
    // --prefix is what keeps this hermetic; a bare `-g` would replace the
    // runner's (or a developer's) global npm.
    expect(args).toContain("--prefix");
    expect(bin).toMatch(/\/bin\/npm$/);
  });

  it("pins a version npm can actually publish with via OIDC (>= 11.5.1)", () => {
    const [major, minor, patch] = NPM_PUBLISH_VERSION.split(".").map(Number);
    expect(major).toBeGreaterThanOrEqual(11);
    // Guard the exact floor so a future downgrade to e.g. 11.4.x — which cannot
    // do OIDC trusted publishing — fails here instead of at publish time.
    if (major === 11 && minor === 5) expect(patch).toBeGreaterThanOrEqual(1);
    if (major === 11) expect(minor).toBeGreaterThanOrEqual(5);
  });

  it("installs only once across many packages (the whole point of the helper)", () => {
    spawnSyncMock.mockReturnValue({ status: 0 });

    const first = resolvePublishNpm();
    const second = resolvePublishNpm();
    const third = resolvePublishNpm();

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
  });

  it("throws rather than falling back to the too-old ambient npm when install fails", () => {
    spawnSyncMock.mockReturnValue({ status: 1 });

    expect(() => resolvePublishNpm()).toThrow(/Failed to install npm@/);
  });

  it("throws when the install reports success but produced no binary", () => {
    spawnSyncMock.mockReturnValue({ status: 0 });
    existsSyncMock.mockReturnValue(false);

    expect(() => resolvePublishNpm()).toThrow(/does not exist/);
  });

  it("does not memoize a failed install", () => {
    spawnSyncMock.mockReturnValueOnce({ status: 1 });
    expect(() => resolvePublishNpm()).toThrow();

    spawnSyncMock.mockReturnValue({ status: 0 });
    expect(resolvePublishNpm()).toMatch(/\/bin\/npm$/);
    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
  });
});
