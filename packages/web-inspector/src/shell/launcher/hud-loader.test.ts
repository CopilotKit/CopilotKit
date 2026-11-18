import { expect, test, vi } from "vitest";

const feed = {
  schemaVersion: 1,
  rules: [
    {
      framework: "react",
      sdkVersion: ">=1.0.0",
      features: { threads: { label: "Threads" } },
    },
  ],
};

test("requests the fixed URL anonymously and shares one request per page", async () => {
  vi.resetModules();
  const request = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(feed)),
  );
  vi.stubGlobal("fetch", request);
  try {
    const { HUD_FEED_URL, loadHudFeed } = await import("./hud-loader.js");
    expect(await Promise.all([loadHudFeed(), loadHudFeed()])).toEqual([
      feed,
      feed,
    ]);
    expect(await loadHudFeed()).toEqual(feed);
    expect(HUD_FEED_URL).toBe(
      "https://cdn.copilotkit.ai/inspector-hud/v1.json",
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(HUD_FEED_URL, {
      cache: "no-cache",
      credentials: "omit",
    });
    expect(new URL(String(request.mock.calls[0]?.[0])).search).toBe("");
  } finally {
    vi.unstubAllGlobals();
  }
});

test.each(["status", "malformed", "invalid", "network", "thrown"])(
  "resolves null on a %s failure, warns once, and does not retry",
  async (failure) => {
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = vi.fn((_url: string) => {
      if (failure === "thrown") throw new Error("fetch unavailable");
      if (failure === "network") return Promise.reject(new Error("offline"));
      if (failure === "status")
        return Promise.resolve(new Response(null, { status: 404 }));
      if (failure === "malformed")
        return Promise.resolve(new Response("{not json"));
      return Promise.resolve(
        new Response(JSON.stringify({ ...feed, schemaVersion: 2 })),
      );
    });
    vi.stubGlobal("fetch", request);
    try {
      const { loadHudFeed } = await import("./hud-loader.js");
      await expect(loadHudFeed()).resolves.toBeNull();
      await expect(loadHudFeed()).resolves.toBeNull();
      expect(request).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "[CopilotKit Inspector] Failed to load HUD content",
        expect.any(Error),
      );
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  },
);

test("does not fetch outside a browser", async () => {
  vi.resetModules();
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  vi.stubGlobal("window", undefined);
  try {
    const { loadHudFeed } = await import("./hud-loader.js");
    await expect(loadHudFeed()).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
