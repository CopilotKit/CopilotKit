/**
 * The presenter reset's ONE job is to guarantee a known-good starting state, so
 * the thing worth testing hardest is not that it works — it is that it REFUSES
 * to say it worked when it did not.
 *
 * The bug these tests pin: `seedMemories` never throws (it counts stored rows
 * and logs the rest), so a naive route falls out of its try block and answers
 * `ok: true, reset: ["store", "memory"]` even when the memory backend rejected
 * every POST. `seeded: 0` then sits in the body, unread, while the presenter
 * walks on stage believing beats 4/5 are armed.
 *
 * Split from `route.test.ts` because `vi.mock` is hoisted per module: this file
 * fakes `data/store`, so it cannot also assert the real store was restored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/skins/logistics/data/store", () => ({ reset: vi.fn() }));
vi.mock("@/skins/logistics/intelligence/forget-memories", () => ({
  forgetAllMemories: vi.fn(),
}));
// Only `seedMemories` is faked. `SEED_MEMORIES` stays REAL so the expected count
// this suite compares against is derived from the same literal the route reads —
// adding a seed memory must not silently turn these assertions into no-ops.
vi.mock(
  "@/skins/logistics/intelligence/seed-memories",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/skins/logistics/intelligence/seed-memories")
    >()),
    seedMemories: vi.fn(),
  }),
);

import * as store from "@/skins/logistics/data/store";
import { forgetAllMemories } from "@/skins/logistics/intelligence/forget-memories";
import {
  SEED_MEMORIES,
  seedMemories,
} from "@/skins/logistics/intelligence/seed-memories";
import {
  memoryScopeUserIds,
  memorySeedTargetUserIds,
} from "@/skins/logistics/intelligence/user-id";
import { POST } from "./route";

beforeEach(() => {
  // Silence the route's own logging without losing a real failure.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Re-established per test rather than in the `vi.mock` factory: the factory
  // runs once, and `restoreAllMocks` strips a factory-set implementation — after
  // which `forgetAllMemories` resolves `undefined`, the route throws on
  // `result.forgot`, and EVERY case lands in the catch path returning a 502 that
  // looks exactly like the failure being asserted.
  vi.mocked(forgetAllMemories).mockResolvedValue({
    forgot: 2,
    alreadyGone: 0,
    skippedProjectScoped: 0,
    failed: [],
    passes: 1,
    complete: true,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** Intelligence configured, and NOT pinned to a single bucket. */
function configureIntelligence() {
  vi.stubEnv("PRESENTER_RESET_ENABLED", "true");
  vi.stubEnv("INTELLIGENCE_API_URL", "http://localhost:7250");
  vi.stubEnv("INTELLIGENCE_API_KEY", "cpk_test");
  vi.stubEnv("INTELLIGENCE_USER_ID", "");
}

describe("POST /api/logistics/v1/dev/reset — the memory half", () => {
  it("403s in production when presenter reset is disabled, touching nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PRESENTER_RESET_ENABLED", "");
    const res = await POST();
    expect(res.status).toBe(403);
    expect(store.reset).not.toHaveBeenCalled();
    expect(forgetAllMemories).not.toHaveBeenCalled();
    expect(seedMemories).not.toHaveBeenCalled();
  });

  it("resets the store only, and claims only that, when Intelligence is unconfigured", async () => {
    vi.stubEnv("PRESENTER_RESET_ENABLED", "true");
    vi.stubEnv("INTELLIGENCE_API_URL", "");
    vi.stubEnv("INTELLIGENCE_API_KEY", "");
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, reset: ["store"] });
    expect(store.reset).toHaveBeenCalledTimes(1);
    expect(seedMemories).not.toHaveBeenCalled();
  });

  it("sweeps every bucket the runtime can reach, not a hand-written list", async () => {
    configureIntelligence();
    vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);

    await POST();

    const swept = vi
      .mocked(forgetAllMemories)
      .mock.calls.map(([params]) => params.userId);
    expect(swept).toEqual([...memoryScopeUserIds()]);
  });

  it("reports success when every expected memory landed in every target bucket", async () => {
    configureIntelligence();
    const targets = memorySeedTargetUserIds();
    vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);

    const res = await POST();

    expect(res.status).toBe(200);
    expect(seedMemories).toHaveBeenCalledTimes(targets.length);
    expect(await res.json()).toMatchObject({
      ok: true,
      reset: ["store", "memory"],
      memory: "seeded",
      seeded: targets.length * SEED_MEMORIES.length,
      expectedSeeds: targets.length * SEED_MEMORIES.length,
    });
  });

  it("does NOT claim memory was reset when the WIPE could not prove it finished", async () => {
    // A memory the wipe missed is worse than a memory the seed missed: it leaves
    // the demo already knowing something, which reads as success on stage.
    configureIntelligence();
    vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);
    vi.mocked(forgetAllMemories).mockResolvedValue({
      forgot: 1,
      alreadyGone: 0,
      skippedProjectScoped: 0,
      failed: [{ id: "r1", reason: "HTTP 500" }],
      passes: 2,
      complete: false,
      incompleteReason: "1 row(s) failed to delete",
    });

    const res = await POST();

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      reset: ["store"],
      memory: "partial",
    });
    expect(body.memoryError).toMatch(/beat 6 already taught/);
  });

  it("refuses to report success when the seed fell short", async () => {
    configureIntelligence();
    vi.mocked(seedMemories).mockResolvedValue(0);

    const res = await POST();

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      reset: ["store"],
      memory: "failed",
      seeded: 0,
    });
    expect(body.memoryError).toMatch(/beats 4\/5 are not armed/);
  });

  it("calls a partial seed partial, and alerts exactly as loudly", async () => {
    configureIntelligence();
    // One row per bucket instead of all of them. A shortfall does not say WHICH
    // memory is missing, so this must not be softened into a 200.
    vi.mocked(seedMemories).mockResolvedValue(1);

    const res = await POST();

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, memory: "partial" });
  });

  it("reports MEASURED progress when the sequence throws part-way", async () => {
    configureIntelligence();
    vi.mocked(forgetAllMemories).mockRejectedValue(
      new Error("[logistics/forget-memories] list memories failed: 401"),
    );

    const res = await POST();

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      reset: ["store"],
      memory: "failed",
      bucketsSwept: 0,
      seeded: 0,
    });
    // Names the phase from the counters, so the presenter is not sent to look at
    // the seed step for a failure in the wipe.
    expect(body.memoryError).toMatch(/interrupted during the wipe phase/);
  });

  it("keeps the backend address out of the response body while logging it", async () => {
    // The gate is a demo convenience, not an authorization boundary: a booth
    // deployment answers this POST for anyone who can reach the box.
    configureIntelligence();
    vi.mocked(forgetAllMemories).mockRejectedValue(
      new Error("Failed to parse URL from http://localhost:7250/api/memories"),
    );

    const res = await POST();
    const body = JSON.stringify(await res.json());

    expect(body).not.toContain("localhost:7250");
    expect(body).not.toContain("cpk_test");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("http://localhost:7250"),
    );
  });
});
