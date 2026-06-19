import { describe, it, expect, vi } from "vitest";
import { createBrowserReadTools } from "./browser-tools";
import type { BridgeRequester } from "./browser-tools";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeBridge(opts: {
  connected: boolean;
  resolveWith?: Record<string, unknown>;
  rejectWith?: Error;
}): BridgeRequester {
  return {
    isConnected: () => opts.connected,
    request: vi.fn(async () => {
      if (opts.rejectWith) throw opts.rejectWith;
      return opts.resolveWith ?? {};
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createBrowserReadTools", () => {
  it("(1) exposes exactly ['browser_read_active_tab']", () => {
    const tools = createBrowserReadTools(fakeBridge({ connected: false }));
    expect(tools.map((t) => t.name)).toEqual(["browser_read_active_tab"]);
  });

  it("(2) returns { connected: true, ...data } when bridge is connected and request resolves", async () => {
    const payload = {
      url: "https://example.com",
      title: "Example Domain",
      selection: "hello",
      text: "Example Domain hello world",
    };
    const tools = createBrowserReadTools(
      fakeBridge({ connected: true, resolveWith: payload }),
    );
    const tool = tools[0];
    const result = await tool.execute({});

    expect(result).toMatchObject({ connected: true, ...payload });
  });

  it("(3) returns { connected: false, message: /no browser connected/i } when not connected", async () => {
    const tools = createBrowserReadTools(fakeBridge({ connected: false }));
    const tool = tools[0];
    const result = (await tool.execute({})) as Record<string, unknown>;

    expect(result.connected).toBe(false);
    expect(typeof result.message).toBe("string");
    expect((result.message as string).toLowerCase()).toMatch(
      /no browser connected/,
    );
  });

  it("(4) returns { connected: false, error: /timed out/i } when request rejects — does NOT throw", async () => {
    const tools = createBrowserReadTools(
      fakeBridge({
        connected: true,
        rejectWith: new Error("Request timed out"),
      }),
    );
    const tool = tools[0];

    let result: Record<string, unknown>;
    await expect(
      (async () => {
        result = (await tool.execute({})) as Record<string, unknown>;
      })(),
    ).resolves.toBeUndefined(); // must NOT throw

    expect(result!.connected).toBe(false);
    expect(typeof result!.error).toBe("string");
    expect((result!.error as string).toLowerCase()).toMatch(/timed out/);
  });
});
