import { describe, expect, it, vi } from "vitest";
import { loadPublishedChannelsManifest } from "./channels-registry.js";

function npm404(): Error & { stderr: string } {
  return Object.assign(new Error("npm view failed"), {
    stderr: "npm error code E404",
  });
}

describe("loadPublishedChannelsManifest", () => {
  it("waits for a just-published package to become visible", async () => {
    const manifest = {
      name: "@copilotkit/channels-whatsapp",
      version: "0.9.1",
    };
    const lookup = vi
      .fn<() => string>()
      .mockImplementationOnce(() => {
        throw npm404();
      })
      .mockReturnValueOnce(JSON.stringify(manifest));
    const sleep = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const onRetry = vi.fn();

    await expect(
      loadPublishedChannelsManifest("@copilotkit/channels-whatsapp", "0.9.1", {
        lookup,
        sleep,
        onRetry,
        maxAttempts: 3,
        retryDelayMs: 10_000,
      }),
    ).resolves.toEqual(manifest);

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(10_000);
    expect(onRetry).toHaveBeenCalledWith(
      "@copilotkit/channels-whatsapp@0.9.1 is not visible on npm yet; retrying in 10s (1/3).",
    );
  });

  it("does not retry non-404 registry failures", async () => {
    const failure = Object.assign(new Error("npm view failed"), {
      stderr: "npm error code E429",
    });
    const lookup = vi.fn<() => string>(() => {
      throw failure;
    });
    const sleep = vi.fn<() => Promise<void>>();

    await expect(
      loadPublishedChannelsManifest("@copilotkit/channels-core", "0.9.1", {
        lookup,
        sleep,
      }),
    ).rejects.toBe(failure);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("fails with release guidance after the visibility window expires", async () => {
    const lookup = vi.fn<() => string>(() => {
      throw npm404();
    });

    await expect(
      loadPublishedChannelsManifest("@copilotkit/channels-core", "0.9.1", {
        lookup,
        sleep: async () => {},
        onRetry: () => {},
        maxAttempts: 2,
      }),
    ).rejects.toThrow(
      "registry is missing @copilotkit/channels-core@0.9.1 after 2 attempts; publish channels-core and every adapter before publishing @copilotkit/channels",
    );
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
