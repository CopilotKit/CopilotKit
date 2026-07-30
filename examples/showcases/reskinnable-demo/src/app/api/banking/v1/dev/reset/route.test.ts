import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/skins/banking/data/store", () => ({ reset: vi.fn() }));
vi.mock("@/skins/banking/intelligence/forget-memories", () => ({
  forgetAllMemories: vi.fn().mockResolvedValue(2),
}));
// #6136 made the route re-seed the demo's starting memory after forgetting; the
// dependency was never mocked, so the test executed the real (network) seeding
// path. Mock it and assert the returned seeded count.
vi.mock("@/skins/banking/intelligence/seed-memories", () => ({
  seedMemories: vi.fn().mockResolvedValue(3),
}));

import * as store from "@/skins/banking/data/store";
import { forgetAllMemories } from "@/skins/banking/intelligence/forget-memories";
import { seedMemories } from "@/skins/banking/intelligence/seed-memories";
import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/banking/v1/dev/reset", () => {
  it("403s when presenter reset is disabled and does not touch state", async () => {
    vi.stubEnv("PRESENTER_RESET_ENABLED", "");
    const res = await POST();
    expect(res.status).toBe(403);
    expect(store.reset).not.toHaveBeenCalled();
    expect(forgetAllMemories).not.toHaveBeenCalled();
  });

  it("resets the store only when Intelligence is unconfigured", async () => {
    vi.stubEnv("PRESENTER_RESET_ENABLED", "true");
    vi.stubEnv("INTELLIGENCE_API_URL", "");
    vi.stubEnv("INTELLIGENCE_API_KEY", "");
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, reset: ["store"] });
    expect(store.reset).toHaveBeenCalledTimes(1);
    expect(forgetAllMemories).not.toHaveBeenCalled();
  });

  it("forgets every seeded persona when Intelligence is configured", async () => {
    vi.stubEnv("PRESENTER_RESET_ENABLED", "true");
    vi.stubEnv("INTELLIGENCE_API_URL", "http://localhost:7050");
    vi.stubEnv("INTELLIGENCE_API_KEY", "cpk_test");
    const res = await POST();
    expect(res.status).toBe(200);
    expect(store.reset).toHaveBeenCalledTimes(1);
    expect(forgetAllMemories).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "jordan-beamson" }),
    );
    expect(forgetAllMemories).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "morgan-fluxx" }),
    );
    // #6136 also forgets the default demo persona: 3 ids × 2 forgotten each = 6.
    // Then it re-seeds the starting memory and returns the seeded count.
    expect(forgetAllMemories).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "northwind-demo-user" }),
    );
    expect(seedMemories).toHaveBeenCalledTimes(1);
    // Assert WHICH persona was re-seeded: the route seeds DEMO_DEFAULT_USER_ID
    // ("northwind-demo-user"), the bucket the "it already knows this" beat reads
    // from. A regression that re-seeded the wrong id would otherwise pass here.
    expect(seedMemories).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "northwind-demo-user" }),
    );
    expect(await res.json()).toEqual({
      ok: true,
      reset: ["store", "memory"],
      forgot: 6,
      seeded: 3,
    });
  });

  it("reports partial progress on a mid-loop memory failure", async () => {
    vi.stubEnv("PRESENTER_RESET_ENABLED", "true");
    vi.stubEnv("INTELLIGENCE_API_URL", "http://localhost:7050");
    vi.stubEnv("INTELLIGENCE_API_KEY", "cpk_test");
    // First persona succeeds (2 forgotten), second persona throws.
    vi.mocked(forgetAllMemories)
      .mockResolvedValueOnce(2)
      .mockRejectedValueOnce(new Error("boom"));
    const res = await POST();
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      ok: false,
      reset: ["store", "memory"],
      forgot: 2,
      memoryError: "boom",
    });
    expect(store.reset).toHaveBeenCalledTimes(1);
  });
});
