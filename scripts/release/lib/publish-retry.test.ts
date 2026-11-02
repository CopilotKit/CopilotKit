import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  matchesPublishedTarball,
  publishWithRetry,
  tarballIntegrity,
} from "./publish-retry.js";

const TLOG_ERROR = `Command failed (exit 1): npm publish copilotkit-shared-2.0.0-rc.12.tgz --tag next --access public
npm error code TLOG_CREATE_ENTRY_ERROR
npm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log`;

const ALREADY_PUBLISHED_ERROR = `Command failed (exit 1): npm publish copilotkit-shared-2.0.0-rc.12.tgz --tag next --access public
npm error code E403
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/@copilotkit%2fshared - You cannot publish over the previously published versions: 2.0.0-rc.12.`;

function attempts(...outcomes: Array<string | Error>) {
  const publish = vi.fn<() => Promise<string>>();
  for (const outcome of outcomes) {
    if (outcome instanceof Error) publish.mockRejectedValueOnce(outcome);
    else publish.mockResolvedValueOnce(outcome);
  }
  return publish;
}

const options = () => ({
  wait: vi.fn(async () => {}),
  log: vi.fn(),
});

describe("publishWithRetry", () => {
  it("publishes once when the first attempt succeeds", async () => {
    const publish = attempts("+ @copilotkit/shared@2.0.0-rc.12");
    const opts = options();

    await expect(
      publishWithRetry("@copilotkit/shared@2.0.0-rc.12", publish, opts),
    ).resolves.toBe("+ @copilotkit/shared@2.0.0-rc.12");
    expect(publish).toHaveBeenCalledTimes(1);
    expect(opts.wait).not.toHaveBeenCalled();
  });

  it("retries a transparency-log failure and backs off longer each time", async () => {
    const publish = attempts(
      new Error(TLOG_ERROR),
      new Error(TLOG_ERROR),
      "+ @copilotkit/shared@2.0.0-rc.12",
    );
    const opts = options();

    await expect(
      publishWithRetry("@copilotkit/shared@2.0.0-rc.12", publish, {
        ...opts,
        delayMs: 1000,
      }),
    ).resolves.toBe("+ @copilotkit/shared@2.0.0-rc.12");
    expect(publish).toHaveBeenCalledTimes(3);
    expect(opts.wait.mock.calls).toEqual([[1000], [2000]]);
    expect(opts.log).toHaveBeenCalledWith(
      expect.stringContaining("npm error code TLOG_CREATE_ENTRY_ERROR"),
    );
  });

  it("rethrows the last failure once attempts run out", async () => {
    const last = new Error(TLOG_ERROR);
    const publish = attempts(
      new Error(TLOG_ERROR),
      new Error(TLOG_ERROR),
      last,
    );

    await expect(
      publishWithRetry("@copilotkit/shared@2.0.0-rc.12", publish, options()),
    ).rejects.toBe(last);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it("counts a retry that finds this run's tarball on npm as published", async () => {
    const publish = attempts(
      new Error("npm error code ECONNRESET"),
      new Error(ALREADY_PUBLISHED_ERROR),
    );
    const confirmPublished = vi.fn(async () => true);
    const opts = options();

    await expect(
      publishWithRetry("@copilotkit/shared@2.0.0-rc.12", publish, {
        ...opts,
        confirmPublished,
      }),
    ).resolves.toContain("previously published");
    expect(publish).toHaveBeenCalledTimes(2);
    expect(confirmPublished).toHaveBeenCalledTimes(1);
    expect(opts.log).toHaveBeenLastCalledWith(
      "  @copilotkit/shared@2.0.0-rc.12 is on npm: an earlier attempt landed.",
    );
  });

  it("fails when the version npm has is a different tarball", async () => {
    const publish = attempts(
      new Error("npm error code ECONNRESET"),
      new Error(ALREADY_PUBLISHED_ERROR),
    );

    await expect(
      publishWithRetry("@copilotkit/shared@2.0.0-rc.12", publish, {
        ...options(),
        confirmPublished: async () => false,
      }),
    ).rejects.toThrow("its tarball is not the one this run built");
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("never counts a taken version as published without a way to confirm it", async () => {
    const last = new Error(ALREADY_PUBLISHED_ERROR);
    const publish = attempts(
      new Error("npm error code ECONNRESET"),
      new Error(ALREADY_PUBLISHED_ERROR),
      last,
    );

    await expect(
      publishWithRetry("@copilotkit/shared@2.0.0-rc.12", publish, options()),
    ).rejects.toBe(last);
  });

  it("does not count a taken version on the first attempt as published", async () => {
    // Before any attempt of ours, a taken version belongs to someone else.
    const publish = attempts(new Error(ALREADY_PUBLISHED_ERROR));
    const confirmPublished = vi.fn(async () => true);

    await expect(
      publishWithRetry("@copilotkit/shared@2.0.0-rc.12", publish, {
        ...options(),
        attempts: 1,
        confirmPublished,
      }),
    ).rejects.toThrow("previously published");
    expect(confirmPublished).not.toHaveBeenCalled();
  });
});

describe("matchesPublishedTarball", () => {
  let dir: string;
  let tarball: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "publish-retry-"));
    tarball = join(dir, "copilotkit-shared-2.0.0-rc.12.tgz");
    writeFileSync(tarball, "tarball bytes");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("computes npm's integrity format for a tarball", () => {
    expect(tarballIntegrity(tarball)).toBe(
      `sha512-${createHash("sha512").update("tarball bytes").digest("base64")}`,
    );
  });

  it("matches when npm recorded this tarball's integrity", async () => {
    const fetchIntegrity = vi.fn(async () => tarballIntegrity(tarball));

    await expect(
      matchesPublishedTarball("@copilotkit/shared", "2.0.0-rc.12", tarball, {
        fetchIntegrity,
      }),
    ).resolves.toBe(true);
    expect(fetchIntegrity).toHaveBeenCalledWith(
      "@copilotkit/shared",
      "2.0.0-rc.12",
    );
  });

  it("does not match a different tarball", async () => {
    await expect(
      matchesPublishedTarball("@copilotkit/shared", "2.0.0-rc.12", tarball, {
        fetchIntegrity: async () => "sha512-somethingelse",
      }),
    ).resolves.toBe(false);
  });

  it("waits for the registry to list a version it just accepted", async () => {
    const fetchIntegrity = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(tarballIntegrity(tarball));
    const wait = vi.fn(async () => {});

    await expect(
      matchesPublishedTarball("@copilotkit/shared", "2.0.0-rc.12", tarball, {
        fetchIntegrity,
        wait,
        delayMs: 1000,
      }),
    ).resolves.toBe(true);
    expect(wait.mock.calls).toEqual([[1000], [1000]]);
  });

  it("looks again when a registry lookup fails", async () => {
    const fetchIntegrity = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error("npm registry returned 503"))
      .mockResolvedValueOnce(tarballIntegrity(tarball));
    const wait = vi.fn(async () => {});

    await expect(
      matchesPublishedTarball("@copilotkit/shared", "2.0.0-rc.12", tarball, {
        fetchIntegrity,
        wait,
      }),
    ).resolves.toBe(true);
    expect(fetchIntegrity).toHaveBeenCalledTimes(2);
  });

  it("rethrows the last failed lookup once attempts run out", async () => {
    await expect(
      matchesPublishedTarball("@copilotkit/shared", "2.0.0-rc.12", tarball, {
        fetchIntegrity: async () => {
          throw new Error("npm registry returned 503");
        },
        wait: async () => {},
        attempts: 2,
      }),
    ).rejects.toThrow("returned 503");
  });

  it("throws when the registry never lists the version", async () => {
    await expect(
      matchesPublishedTarball("@copilotkit/shared", "2.0.0-rc.12", tarball, {
        fetchIntegrity: async () => null,
        wait: async () => {},
        attempts: 3,
        delayMs: 1000,
      }),
    ).rejects.toThrow("still does not list it after 2s");
  });
});
