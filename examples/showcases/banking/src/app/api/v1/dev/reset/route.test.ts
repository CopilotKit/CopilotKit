import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/store", () => ({ reset: vi.fn() }));
vi.mock("@/lib/intelligence/forget-memories", () => ({
  forgetAllMemories: vi.fn().mockResolvedValue(2),
}));

import * as store from "@/lib/store";
import { forgetAllMemories } from "@/lib/intelligence/forget-memories";
import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/v1/dev/reset", () => {
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
    expect(await res.json()).toEqual({
      ok: true,
      reset: ["store", "memory"],
      forgot: 4,
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
