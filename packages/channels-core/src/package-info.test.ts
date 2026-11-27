import { beforeEach, describe, expect, it, vi } from "vitest";

const createRequireMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new TypeError("import.meta.url is unavailable");
  }),
);

vi.mock("node:module", () => ({
  createRequire: createRequireMock,
}));

describe("getChannelsCorePackageInfo", () => {
  beforeEach(() => {
    createRequireMock.mockClear();
    vi.resetModules();
  });

  it("does not access import.meta.url at module load and falls back in workers", async () => {
    const { getChannelsCorePackageInfo } = await import("./package-info.js");

    expect(createRequireMock).not.toHaveBeenCalled();
    expect(getChannelsCorePackageInfo()).toEqual({
      name: "@copilotkit/channels-core",
      version: "0.0.0-unbuilt",
    });
    expect(createRequireMock).toHaveBeenCalledTimes(1);
  });
});
