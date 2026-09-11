import { expect, test, vi } from "vitest";

test("fetches once per page and shares the validated result", async () => {
  vi.resetModules();
  const feed = { schemaVersion: 1, notifications: [] };
  const request = vi.fn(async () => new Response(JSON.stringify(feed)));
  vi.stubGlobal("fetch", request);
  try {
    const { loadNotificationFeed } = await import("../notification-loader.js");
    expect(
      await Promise.all([loadNotificationFeed(), loadNotificationFeed()]),
    ).toEqual([feed, feed]);
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
  "quietly caches a %s failure",
  async (failure) => {
    vi.resetModules();
    const request = vi.fn(async (_input: unknown) => {
      if (failure === "network") throw new Error("offline");
      return new Response("{}", { status: failure === "status" ? 500 : 200 });
    });
    vi.stubGlobal("fetch", request);
    try {
      const { loadNotificationFeed } =
        await import("../notification-loader.js");
      expect(await loadNotificationFeed()).toBeNull();
      expect(await loadNotificationFeed()).toBeNull();
      expect(request).toHaveBeenCalledTimes(1);
      expect(
        request.mock.calls.every(
          (call) => !String(call[0]).includes("announcements.json"),
        ),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
