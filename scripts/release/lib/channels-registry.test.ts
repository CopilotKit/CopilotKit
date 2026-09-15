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

  // The channels v0.9.3 release. All eight adapters published, the metadata poll let the
  // umbrella through, and then `pnpm install` went for the bytes:
  //
  //   ERR_PNPM_FETCH_404  GET .../@copilotkit/channels-slack/-/channels-slack-0.9.3.tgz
  //   This error happened while installing the dependencies of @copilotkit/channels@0.9.3
  //
  // Metadata lands before the tarball is servable, so a manifest that parses is not
  // evidence the package can be installed. The umbrella is verified by installing it, so
  // the tarball is the thing this wait actually needs.
  it("keeps waiting when the manifest is published but its tarball is not servable", async () => {
    const manifest = {
      name: "@copilotkit/channels-slack",
      version: "0.9.3",
      dist: {
        tarball:
          "https://registry.npmjs.org/@copilotkit/channels-slack/-/channels-slack-0.9.3.tgz",
      },
    };
    const lookup = vi
      .fn<() => string>()
      .mockReturnValue(JSON.stringify(manifest));
    const headTarball = vi
      .fn<(url: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const sleep = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const onRetry = vi.fn();

    await expect(
      loadPublishedChannelsManifest("@copilotkit/channels-slack", "0.9.3", {
        lookup,
        headTarball,
        sleep,
        onRetry,
        maxAttempts: 3,
        retryDelayMs: 10_000,
      }),
    ).resolves.toEqual(manifest);

    expect(headTarball).toHaveBeenCalledTimes(2);
    expect(headTarball).toHaveBeenCalledWith(manifest.dist.tarball);
    expect(sleep).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith(
      "@copilotkit/channels-slack@0.9.3 is published but its tarball is not servable yet; retrying in 10s (1/3).",
    );
  });

  it("fails naming the tarball when it never becomes servable", async () => {
    const manifest = {
      name: "@copilotkit/channels-slack",
      version: "0.9.3",
      dist: { tarball: "https://registry.npmjs.org/x.tgz" },
    };

    await expect(
      loadPublishedChannelsManifest("@copilotkit/channels-slack", "0.9.3", {
        lookup: () => JSON.stringify(manifest),
        headTarball: async () => false,
        sleep: async () => {},
        onRetry: () => {},
        maxAttempts: 2,
      }),
    ).rejects.toThrow(
      "registry has not served the tarball for @copilotkit/channels-slack@0.9.3 after 2 attempts",
    );
  });
});

