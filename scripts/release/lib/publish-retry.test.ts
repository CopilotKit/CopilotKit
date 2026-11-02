import { describe, expect, it, vi } from "vitest";
import { publishWithRetry } from "./publish-retry.js";

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

  it("counts a retry that finds the version taken as published", async () => {
    const publish = attempts(
      new Error("npm error code ECONNRESET"),
      new Error(ALREADY_PUBLISHED_ERROR),
    );
    const opts = options();

    await expect(
      publishWithRetry("@copilotkit/shared@2.0.0-rc.12", publish, opts),
    ).resolves.toContain("previously published");
    expect(publish).toHaveBeenCalledTimes(2);
    expect(opts.log).toHaveBeenLastCalledWith(
      "  @copilotkit/shared@2.0.0-rc.12 is on npm: an earlier attempt landed.",
    );
  });

  it("does not count a taken version on the first attempt as published", async () => {
    // Before any attempt of ours, a taken version belongs to someone else.
    const publish = attempts(new Error(ALREADY_PUBLISHED_ERROR));

    await expect(
      publishWithRetry("@copilotkit/shared@2.0.0-rc.12", publish, {
        ...options(),
        attempts: 1,
      }),
    ).rejects.toThrow("previously published");
  });
});
