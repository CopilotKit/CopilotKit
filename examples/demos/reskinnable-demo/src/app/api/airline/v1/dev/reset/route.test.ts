/**
 * The presenter reset's ONE job is to guarantee a known-good starting state, so
 * the thing worth testing hardest is not that it works — it is that it REFUSES to
 * say it worked when it did not.
 *
 * Two halves, and both used to be missing here. The STORE half (below, against the
 * REAL store) proves that every record the beats write is put back. The MEMORY
 * half proves the route will not claim `reset: ["store", "memory"]` on a backend
 * that rejected everything — the bug commerce pinned first: `seedMemories` never
 * throws (it counts stored rows and logs the rest), so a route that merely falls
 * out of its try block answers `ok: true` with `seeded: 0` sitting unread in the
 * body while the presenter walks on stage believing beats 4/5 are armed.
 *
 * ⚠️ THE STORE IS REAL AND THE INTELLIGENCE MODULES ARE MOCKED, deliberately. The
 * store assertions are the point of the first case and a `vi.mock` would make them
 * vacuous; the memory modules talk to a backend that is not running in unit tests.
 * `SEED_MEMORIES` stays REAL so the expected count is derived from the same literal
 * the route reads — adding a seed memory must not silently turn these assertions
 * into no-ops.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/skins/airline/intelligence/forget-memories", () => ({
  forgetAllMemories: vi.fn(),
}));
vi.mock(
  "@/skins/airline/intelligence/seed-memories",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/skins/airline/intelligence/seed-memories")
    >()),
    seedMemories: vi.fn(),
  }),
);

import * as store from "@/skins/airline/data/store";
import { forgetAllMemories } from "@/skins/airline/intelligence/forget-memories";
import {
  SEED_MEMORIES,
  seedMemories,
} from "@/skins/airline/intelligence/seed-memories";
import { memorySeedTargetUserIds } from "@/skins/airline/intelligence/user-id";
import { POST } from "./route";

beforeEach(() => {
  store.reset();
  // Silence the route's own reset logging without losing a real failure.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Re-established per test rather than in the `vi.mock` factory: the factory runs
  // once, and `restoreAllMocks` strips a factory-set implementation — after which
  // `forgetAllMemories` resolves `undefined`, the route throws on `result.forgot`,
  // and EVERY case lands in the catch path returning a 502 that looks exactly like
  // the failure being asserted.
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
  vi.stubEnv("CPK_INTELLIGENCE_API_KEY", "cpk_test");
  vi.stubEnv("INTELLIGENCE_USER_ID", "");
}

/** Intelligence absent — the OSS path every unit run takes by default. */
function unconfigureIntelligence() {
  vi.stubEnv("INTELLIGENCE_API_URL", "");
  vi.stubEnv("CPK_INTELLIGENCE_API_KEY", "");
}

describe("POST /dev/reset — the store", () => {
  it("puts back everything the beats wrote", async () => {
    unconfigureIntelligence();
    const booking = store.findBooking("bkg-av1466");
    const gated = store.findBooking("bkg-av2214");
    const option = store.options()[0];
    if (!booking || !gated) throw new Error("missing fixture");

    store.reissueBooking(booking, option, 0, "involuntary");
    store.notifyParty(booking, "arrival-pickup", "new-arrival-time");
    const filed = store.fileException(
      gated,
      "SCHEDULE_CHANGE_TRIGGERED",
      "notice AV-88214",
      "",
    );
    if (!filed.ok) throw new Error("could not file");
    store.approveException(filed.exception.id);

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reset).toEqual(["store"]);

    expect(store.findBooking("bkg-av1466")?.status).toBe("ticketed");
    expect(store.findBooking("bkg-av1466")?.notices).toEqual([]);
    expect(store.findBooking("bkg-av2214")?.activeExceptionId).toBeNull();
    expect(store.exceptions()).toEqual([]);
    expect(store.briefs()).toEqual([]);
  });

  it("403s in production unless a booth deployment enabled it", async () => {
    unconfigureIntelligence();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PRESENTER_RESET_ENABLED", "");
    expect((await POST()).status).toBe(403);

    vi.stubEnv("PRESENTER_RESET_ENABLED", "true");
    expect((await POST()).status).toBe(200);
  });

  it("is allowed outside production without the flag", async () => {
    unconfigureIntelligence();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PRESENTER_RESET_ENABLED", "");
    expect((await POST()).status).toBe(200);
  });

  it("touches nothing at all when the production gate refuses", async () => {
    configureIntelligence();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PRESENTER_RESET_ENABLED", "");
    expect((await POST()).status).toBe(403);
    expect(forgetAllMemories).not.toHaveBeenCalled();
    expect(seedMemories).not.toHaveBeenCalled();
  });
});

describe("POST /dev/reset — the memory beats", () => {
  it("claims the store ONLY when Intelligence is unconfigured", async () => {
    // The OSS path. Beats 4/5/6 degrade by design there, and the body must not
    // imply a re-arm that never happened.
    vi.stubEnv("PRESENTER_RESET_ENABLED", "true");
    unconfigureIntelligence();
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, reset: ["store"] });
    expect(seedMemories).not.toHaveBeenCalled();
  });

  it("no longer claims the memory beats are unarmed", async () => {
    // ⚠️ THE REGRESSION THIS FILE EXISTS TO PIN. Before the seed module landed this
    // route answered `memoryBeats: "unarmed"` with a `memoryNote` naming the
    // missing file, and `data/beat-map.md` trap 3 asked for that field to be
    // deleted in the SAME change that added the seed. Both fields gone is what
    // stops the button claiming less than it does — the mirror image of the lie the
    // rest of this suite guards.
    configureIntelligence();
    vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);
    const body = await (await POST()).json();
    expect(body.memoryBeats).toBeUndefined();
    expect(body.memoryNote).toBeUndefined();
    expect(body.reset).toContain("memory");
  });

  it("reports success when every expected memory landed in every target bucket", async () => {
    configureIntelligence();
    const targets = memorySeedTargetUserIds();
    // Seeding the DEFAULT bucket as well as the account holder's is deliberate —
    // runs frequently resolve to the default — so this is >1 and the route's
    // expectation has to scale with it.
    expect(targets.length).toBeGreaterThan(1);
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

  it("does NOT report ok/memory-reset when every seed POST failed", async () => {
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
    expect(body.memoryError).toContain("beats 4/5 are not armed");
  });

  it("distinguishes a partial seed from a total failure", async () => {
    configureIntelligence();
    // One row of two, in one bucket of several.
    vi.mocked(seedMemories).mockResolvedValueOnce(1).mockResolvedValue(0);

    const res = await POST();

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      ok: false,
      memory: "partial",
      seeded: 1,
    });
  });

  it("does NOT report ok/memory-reset when the WIPE could not prove it finished", async () => {
    // The more dangerous half of the same question. A short SEED leaves a beat
    // unarmed and visibly quiet. A memory the wipe MISSED leaves the demo already
    // knowing something — so beat 6 can look taught before anyone taught it, which
    // reads as success and proves nothing.
    configureIntelligence();
    vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);
    vi.mocked(forgetAllMemories).mockResolvedValue({
      forgot: 1,
      alreadyGone: 0,
      skippedProjectScoped: 0,
      failed: [{ id: "mem-1", reason: "HTTP 500" }],
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
    expect(body.memoryError).toContain("beat 6 already taught");
    expect(body.forgetShortfalls.join(" ")).toContain("failed to delete");
  });

  it("reports PARTIAL rather than 'memory untouched' when the sequence throws", async () => {
    // Nobody exercises this path until it fires at a booth. `forgetAllMemories`
    // throws when a bucket cannot be ENUMERATED, and the body has to report the
    // phase and the counters rather than inferring memory state from one number.
    configureIntelligence();
    vi.mocked(forgetAllMemories).mockRejectedValue(new Error("list failed"));

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
    expect(body.memoryError).toContain("wipe phase");
  });

  it("scales the expectation to the collapsed bucket set when the user id is pinned", async () => {
    // Playwright pins `INTELLIGENCE_USER_ID`, which short-circuits `resolveUserId`
    // and collapses every bucket onto one. The route must expect ONE bucket's worth
    // of seeds, not the roster's — otherwise every pinned run reports `partial` on
    // a perfectly successful reset.
    configureIntelligence();
    vi.stubEnv("INTELLIGENCE_USER_ID", "pinned-user");
    const targets = memorySeedTargetUserIds();
    expect(targets).toEqual(["pinned-user"]);
    vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);

    const res = await POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      memory: "seeded",
      expectedSeeds: SEED_MEMORIES.length,
    });
  });
});
