import { describe, it, expect, vi, afterEach } from "vitest";
import { IntelligenceFileHistoryClient } from "./intelligence-file-history.js";
import type { EgressRoute } from "./contracts.js";

/** A slack reply target with a thread anchor so getHistory issues the fetch. */
const slackRoute = {
  adapter: "slack",
  teamId: "T1",
  channel: "C1",
  threadTs: "1700.5",
} as unknown as EgressRoute;

function stubFetchReturning(messages: unknown[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ messages }),
    })),
  );
}

describe("IntelligenceFileHistoryClient.getHistory", () => {
  afterEach(() => vi.unstubAllGlobals());

  const client = new IntelligenceFileHistoryClient({
    baseUrl: "http://app-api.test",
    apiKey: "cpk-test",
  });

  it("returns [] for limit <= 0 instead of the full history (slice(-0) guard)", async () => {
    // The server over-returns; a raw `slice(-0)` would hand back ALL of it.
    stubFetchReturning([
      { id: "m1", role: "user", text: "one" },
      { id: "m2", role: "assistant", text: "two" },
      { id: "m3", role: "user", text: "three" },
    ]);

    const out = await client.getHistory(slackRoute, 0);
    expect(out).toEqual([]);
  });

  it("caps to the most recent `limit` messages", async () => {
    stubFetchReturning(
      Array.from({ length: 5 }, (_, i) => ({
        id: `m${i}`,
        role: "user",
        text: `t${i}`,
      })),
    );

    const out = await client.getHistory(slackRoute, 2);
    expect(out.map((m) => m.id)).toEqual(["m3", "m4"]);
  });
});

describe("IntelligenceFileHistoryClient — injectable fetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses config.fetch for binary downloads instead of the global fetch", async () => {
    // The binary/history/upload paths hardcoded globalThis.fetch, so a consumer
    // (or test) injecting config.fetch had it ignored here. Stub the global to
    // throw so the test fails loudly if the injected fetch is not honored.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(
          "global fetch must not be used when config.fetch is set",
        );
      }),
    );
    const png = new Uint8Array([1, 2, 3, 4]);
    const injectedCalls: string[] = [];
    const injected = (async (url: string) => {
      injectedCalls.push(String(url));
      return {
        ok: true,
        status: 200,
        headers: {
          get: (k: string) => (k === "content-type" ? "image/png" : null),
        },
        body: null,
        arrayBuffer: async () => png.buffer,
      };
    }) as unknown as typeof fetch;

    const client = new IntelligenceFileHistoryClient({
      baseUrl: "http://x",
      apiKey: "cpk-test",
      fetch: injected,
    });

    await expect(client.fetchFile("fileref_1")).resolves.toEqual({
      bytes: png,
      mimeType: "image/png",
    });
    expect(injectedCalls).toEqual(["http://x/api/channels/files/fileref_1"]);
  });
});
