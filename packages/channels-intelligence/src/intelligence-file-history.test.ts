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
