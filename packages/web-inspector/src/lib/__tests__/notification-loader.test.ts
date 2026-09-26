import { expect, test, vi } from "vitest";

test("adds framework and SDK version and shares one request for that pair", async () => {
  vi.resetModules();
  const feed = { schemaVersion: 1, notifications: [] };
  const request = vi.fn(async () => new Response(JSON.stringify(feed)));
  vi.stubGlobal("fetch", request);
  try {
    const { loadNotificationFeed } = await import("../notification-loader.js");
    expect(
      await Promise.all([
        loadNotificationFeed({ framework: "react", sdkVersion: "1.73.3" }),
        loadNotificationFeed({ framework: "react", sdkVersion: "1.73.3" }),
      ]),
    ).toEqual([feed, feed]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "https://cdn.copilotkit.ai/notifications/v1.json?framework=react&sdkVersion=1.73.3",
      expect.any(Object),
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

test("separates requests for different framework versions", async () => {
  vi.resetModules();
  const feed = { schemaVersion: 1, notifications: [] };
  const request = vi.fn(
    async (_url: string) => new Response(JSON.stringify(feed)),
  );
  vi.stubGlobal("fetch", request);
  try {
    const { loadNotificationFeed } = await import("../notification-loader.js");

    await loadNotificationFeed({ framework: "react", sdkVersion: "1.73.3" });
    await loadNotificationFeed({ framework: "angular", sdkVersion: "0.5.2" });
    await loadNotificationFeed({ framework: "react", sdkVersion: "1.73.3" });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "https://cdn.copilotkit.ai/notifications/v1.json?framework=react&sdkVersion=1.73.3",
      "https://cdn.copilotkit.ai/notifications/v1.json?framework=angular&sdkVersion=0.5.2",
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("uses the unfiltered URL when framework or version is unknown", async () => {
  vi.resetModules();
  const feed = { schemaVersion: 1, notifications: [] };
  const request = vi.fn(async () => new Response(JSON.stringify(feed)));
  vi.stubGlobal("fetch", request);
  try {
    const { loadNotificationFeed } = await import("../notification-loader.js");

    await loadNotificationFeed({ framework: "react" });
    await loadNotificationFeed({ sdkVersion: "1.73.3" });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "https://cdn.copilotkit.ai/notifications/v1.json",
      expect.any(Object),
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

test.each(["malformed", "network", "status"])(
  "caches a %s failure and warns once",
  async (failure) => {
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = vi.fn(async (_input: unknown) => {
      if (failure === "network") throw new Error("offline");
      return new Response("{}", { status: failure === "status" ? 500 : 200 });
    });
    vi.stubGlobal("fetch", request);
    try {
      const { loadNotificationFeed } =
        await import("../notification-loader.js");
      expect(
        await loadNotificationFeed({
          framework: "react",
          sdkVersion: "1.73.3",
        }),
      ).toBeNull();
      expect(
        await loadNotificationFeed({
          framework: "react",
          sdkVersion: "1.73.3",
        }),
      ).toBeNull();
      expect(request).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(
        request.mock.calls.every(
          (call) => !String(call[0]).includes("announcements.json"),
        ),
      ).toBe(true);
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  },
);
