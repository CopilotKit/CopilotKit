import {
  CopilotKitIntelligence,
  LearnedSkillsError,
} from "@copilotkit/runtime/v2";
import type { LearnedSkillsSnapshotResult } from "@copilotkit/runtime/v2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "../../conformance/snapshots.v1.json";
import { SkillRegistry } from "../registry.js";

function response(name = "text-skill"): LearnedSkillsSnapshotResult {
  const fixture = fixtures.cases.find((item) => item.name === name)!;
  return {
    status: "snapshot",
    bytes: new Uint8Array(Buffer.from(fixture.archiveBase64, "base64")),
    revision: fixture.revision,
    etag: fixture.etag,
    contentType: "application/zip",
  };
}
function setup(options: Record<string, unknown> = {}) {
  const client = new CopilotKitIntelligence({ apiKey: "never-log-this-key" });
  const fetch = vi.spyOn(client, "getLearnedSkillsSnapshot");
  const registry = new SkillRegistry({
    client,
    containerId: "container",
    ...options,
  });
  return { registry, fetch, client };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("registry lifecycle", () => {
  it("shares one cold request among initialization and invocation callers", async () => {
    const { registry, fetch } = setup();
    let resolve!: (value: LearnedSkillsSnapshotResult) => void;
    fetch.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const init = registry.initialize();
    const first = registry.acquireSnapshot();
    const second = registry.acquireSnapshot();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(response());
    await init;
    expect(await first).toBe(await second);
    expect(registry.status).toMatchObject({
      initialized: true,
      revision: "r1",
      mode: "latest",
      stale: false,
      lastCheckedAt: "1970-01-01T00:00:00.000Z",
    });
  });
  it("blocks warm invocations after malformed HTTP 401 from the canonical client", async () => {
    const initial = response();
    if (initial.status !== "snapshot") throw new Error("fixture");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(Buffer.from(initial.bytes), {
          headers: {
            "content-type": initial.contentType,
            "x-copilotkit-skills-revision": initial.revision,
            etag: initial.etag,
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response("<html>denied</html>", { status: 401 }),
      );
    vi.stubGlobal("fetch", fetch);
    const registry = new SkillRegistry({
      client: new CopilotKitIntelligence({ apiKey: "secret" }),
      containerId: "container",
    });
    const pinned = await registry.acquireSnapshot();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(registry.acquireSnapshot()).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED",
    });
    expect(pinned.revision).toBe(initial.revision);
    expect(registry.status.lastError?.code).toBe("AUTHENTICATION_FAILED");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])(
    "blocks a warm registry when HTTP %s has a stalled body",
    async (status) => {
      const initial = response();
      if (initial.status !== "snapshot") throw new Error("fixture");
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(Buffer.from(initial.bytes), {
            headers: {
              "content-type": initial.contentType,
              "x-copilotkit-skills-revision": initial.revision,
              etag: initial.etag,
            },
          }),
        )
        .mockResolvedValueOnce(new Response(new ReadableStream(), { status }))
        .mockRejectedValueOnce(new TypeError("offline"));
      vi.stubGlobal("fetch", fetch);
      const registry = new SkillRegistry({
        client: new CopilotKitIntelligence({ apiKey: "secret" }),
        containerId: "c",
      });
      await registry.initialize();
      await vi.advanceTimersByTimeAsync(5000);
      const result = registry.acquireSnapshot().then(
        () => null,
        (error) => error,
      );
      await vi.advanceTimersByTimeAsync(5001);
      const code =
        status === 401 ? "AUTHENTICATION_FAILED" : "AUTHORIZATION_FAILED";
      expect(await result).toMatchObject({ code, retryable: false });
      expect(registry.status.stale).toBe(false);
      await expect(registry.acquireSnapshot()).rejects.toMatchObject({ code });
    },
  );

  it("clears warm stale state after a matching 304 recovery", async () => {
    const { registry, fetch } = setup();
    const initial = response();
    fetch
      .mockResolvedValueOnce(initial)
      .mockRejectedValueOnce(new LearnedSkillsError("NETWORK_ERROR", true))
      .mockResolvedValueOnce({
        status: "unchanged",
        revision: initial.revision,
        etag: initial.etag,
      });
    const pinned = await registry.acquireSnapshot();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await registry.acquireSnapshot()).toBe(pinned);
    expect(registry.status.stale).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await registry.acquireSnapshot()).toBe(pinned);
    expect(registry.status).toMatchObject({
      stale: false,
      lastCheckedAt: "1970-01-01T00:00:06.000Z",
    });
    expect(registry.status.lastError).toBeUndefined();
  });

  it("treats an empty verified manifest as successful initialization", async () => {
    const { registry, fetch } = setup();
    fetch.mockResolvedValue(response("empty"));
    expect((await registry.acquireSnapshot()).skills).toEqual([]);
    expect(registry.status.initialized).toBe(true);
  });
  it("coalesces the first expired warm refresh and counts 304 as a successful check", async () => {
    const { registry, fetch } = setup();
    const initial = response();
    fetch.mockResolvedValueOnce(initial);
    const pinned = await registry.acquireSnapshot();
    await vi.advanceTimersByTimeAsync(4999);
    expect(await registry.acquireSnapshot()).toBe(pinned);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    fetch.mockResolvedValue({
      status: "unchanged",
      revision: initial.revision,
      etag: initial.etag,
    });
    const next = await Promise.all([
      registry.acquireSnapshot(),
      registry.acquireSnapshot(),
      registry.acquireSnapshot(),
    ]);
    expect(next.every((value) => value === pinned)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toMatchObject({
      containerId: "container",
      ifNoneMatch: initial.etag,
      signal: expect.any(AbortSignal),
    });
    expect(registry.status.lastCheckedAt).toBe("1970-01-01T00:00:05.000Z");
    await registry.acquireSnapshot();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("keeps immutable pinned objects while atomically installing a changed snapshot", async () => {
    const { registry, fetch } = setup();
    fetch.mockResolvedValueOnce(response());
    const old = await registry.acquireSnapshot();
    await vi.advanceTimersByTimeAsync(5000);
    fetch.mockResolvedValueOnce(response("empty-r2"));
    const next = await registry.acquireSnapshot();
    expect(next).not.toBe(old);
    expect(next.skills).toEqual([]);
    expect(old.skills).toHaveLength(1);
  });
  it.each([
    "NETWORK_ERROR",
    "TIMEOUT",
    "INVALID_SNAPSHOT",
    "UNSUPPORTED_SERVER",
  ])("keeps a warm snapshot indefinitely on %s", async (code) => {
    const { registry, fetch } = setup();
    fetch.mockResolvedValueOnce(response());
    const old = await registry.acquireSnapshot();
    await vi.advanceTimersByTimeAsync(365 * 24 * 60 * 60 * 1000);
    fetch.mockRejectedValue(new LearnedSkillsError(code as any, true));
    expect(await registry.acquireSnapshot()).toBe(old);
    expect(registry.status).toMatchObject({
      stale: true,
      lastError: { code },
      lastCheckedAt: "1970-01-01T00:00:00.000Z",
    });
    expect(await registry.acquireSnapshot()).toBe(old);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each([
    "AUTHENTICATION_FAILED",
    "AUTHORIZATION_FAILED",
    "ENTITLEMENT_REQUIRED",
    "DELIVERY_DISABLED",
    "REVISION_REVOKED",
  ])(
    "blocks new invocations after %s even if the next request is unreachable",
    async (code) => {
      const { registry, fetch } = setup();
      fetch.mockResolvedValueOnce(response());
      const old = await registry.acquireSnapshot();
      await vi.advanceTimersByTimeAsync(5000);
      fetch.mockRejectedValueOnce(new LearnedSkillsError(code as any, false));
      await expect(registry.acquireSnapshot()).rejects.toMatchObject({ code });
      fetch.mockRejectedValueOnce(
        new LearnedSkillsError("NETWORK_ERROR", true),
      );
      await expect(registry.acquireSnapshot()).rejects.toMatchObject({ code });
      expect(old.skills).toHaveLength(1);
      expect(registry.status.stale).toBe(false);
      fetch.mockResolvedValueOnce(response());
      expect(await registry.acquireSnapshot()).toMatchObject({
        revision: "r1",
      });
      expect(registry.status.lastError).toBeUndefined();
    },
  );
  it("allows initialization to retry after a catchable cold failure", async () => {
    const { registry, fetch } = setup();
    fetch.mockRejectedValueOnce(new LearnedSkillsError("NETWORK_ERROR", true));
    await expect(registry.initialize()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(registry.status.initialized).toBe(false);
    fetch.mockResolvedValueOnce(response());
    await registry.initialize();
    expect(registry.status.initialized).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("times out a client that ignores cancellation without a hidden retry", async () => {
    const { registry, fetch } = setup();
    fetch.mockReturnValue(new Promise(() => {}));
    const pending = registry.acquireSnapshot();
    const rejection = expect(pending).rejects.toMatchObject({
      code: "TIMEOUT",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(5001);
    await rejection;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0].signal?.aborted).toBe(true);
  });
  it("never installs a late response after a timed-out refresh", async () => {
    const { registry, fetch } = setup();
    let resolve!: (value: LearnedSkillsSnapshotResult) => void;
    fetch.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const first = registry.acquireSnapshot();
    const rejection = expect(first).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(5001);
    await rejection;
    fetch.mockResolvedValueOnce(response("empty"));
    await registry.initialize();
    resolve(response());
    await Promise.resolve();
    expect((await registry.acquireSnapshot()).skills).toEqual([]);
  });
  it("always sends an exact opaque pin and rejects another revision", async () => {
    const { registry, fetch } = setup({ revision: "opaque/pin" });
    fetch.mockResolvedValue(response());
    await expect(registry.acquireSnapshot()).rejects.toMatchObject({
      code: "INVALID_SNAPSHOT",
    });
    expect(fetch.mock.calls[0]?.[0].revision).toBe("opaque/pin");
    expect(registry.status.mode).toBe("pinned");
  });
  it("rejects cold 304 and mismatched warm 304 metadata", async () => {
    const { registry, fetch } = setup();
    fetch.mockResolvedValueOnce({
      status: "unchanged",
      revision: "r1",
      etag: "bad",
    });
    await expect(registry.initialize()).rejects.toMatchObject({
      code: "INVALID_SNAPSHOT",
    });
    fetch.mockResolvedValueOnce(response());
    const old = await registry.acquireSnapshot();
    await vi.advanceTimersByTimeAsync(5000);
    fetch.mockResolvedValueOnce({
      status: "unchanged",
      revision: "other",
      etag: old.etag,
    });
    expect(await registry.acquireSnapshot()).toBe(old);
    expect(registry.status.stale).toBe(true);
  });
  it("maps a malformed injected-client response to INVALID_SNAPSHOT", async () => {
    const { registry, fetch } = setup();
    fetch.mockResolvedValue(null as unknown as LearnedSkillsSnapshotResult);
    await expect(registry.initialize()).rejects.toMatchObject({
      code: "INVALID_SNAPSHOT",
    });
  });

  it("coalesces confirmed denial requests for concurrent warm invocations", async () => {
    const { registry, fetch } = setup();
    fetch.mockResolvedValueOnce(response());
    await registry.initialize();
    await vi.advanceTimersByTimeAsync(5000);
    fetch.mockRejectedValueOnce(
      new LearnedSkillsError("REVISION_REVOKED", false),
    );
    const results = await Promise.allSettled([
      registry.acquireSnapshot(),
      registry.acquireSnapshot(),
      registry.acquireSnapshot(),
    ]);
    expect(results).toHaveLength(3);
    for (const result of results)
      expect(result).toMatchObject({
        status: "rejected",
        reason: { code: "REVISION_REVOKED" },
      });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns a frozen status value without exception causes or caller mutation", async () => {
    const { registry, fetch } = setup();
    fetch.mockRejectedValue(
      new LearnedSkillsError(
        "NETWORK_ERROR",
        true,
        new Error("private diagnostic"),
      ),
    );
    await expect(registry.initialize()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    const status = registry.status;
    expect(Object.isFrozen(status)).toBe(true);
    expect(Object.isFrozen(status.lastError)).toBe(true);
    expect(status.lastError).not.toHaveProperty("cause");
  });
  it.each([false, true])(
    "logs only safe metadata when debug=%s",
    async (debug) => {
      const log = vi.spyOn(console, "debug").mockImplementation(() => {});
      const { registry, fetch } = setup({ debug });
      fetch.mockResolvedValueOnce(response());
      await registry.initialize();
      await vi.advanceTimersByTimeAsync(5000);
      fetch.mockRejectedValueOnce(
        new LearnedSkillsError(
          "NETWORK_ERROR",
          true,
          new Error("private prompt"),
        ),
      );
      await registry.acquireSnapshot();
      if (debug) expect(log).toHaveBeenCalled();
      else expect(log).not.toHaveBeenCalled();
      const output = JSON.stringify(log.mock.calls);
      for (const secret of [
        "never-log-this-key",
        "private prompt",
        "Refunds are available",
        "# Refund policy",
      ])
        expect(output).not.toContain(secret);
    },
  );
});
