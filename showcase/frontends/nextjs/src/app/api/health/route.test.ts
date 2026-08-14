import { describe, expect, it } from "vitest";

import { dynamic, GET } from "./route";

describe("GET /api/health", () => {
  it("returns 200 with an ok status", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      frontend: "nextjs",
    });
  });

  it("stamps a fresh ISO timestamp on every response", async () => {
    // The field exists so an operator can tell a live answer from a cached
    // one. Asserting only `status: "ok"` let it become an empty string, a
    // number, or a value frozen at build time without anything noticing.
    const before = Date.now();
    const body = (await (await GET()).json()) as { timestamp?: unknown };
    const after = Date.now();

    expect(typeof body.timestamp).toBe("string");
    const stamped = Date.parse(body.timestamp as string);
    expect(Number.isNaN(stamped)).toBe(false);
    // Round-trips as an ISO-8601 UTC string, which is what `toISOString`
    // promises and what log collectors parse.
    expect(new Date(stamped).toISOString()).toBe(body.timestamp);
    // 1s of slack on each side for clock granularity.
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(after + 1000);
  });

  it("opts out of static rendering", () => {
    // Without `dynamic = "force-dynamic"` Next.js may render this route once
    // at build time and serve that answer forever — a health check that
    // reports "ok" from a frozen snapshot is worse than no health check,
    // because the deploy probe passes while the app is down.
    expect(dynamic).toBe("force-dynamic");
  });
});
