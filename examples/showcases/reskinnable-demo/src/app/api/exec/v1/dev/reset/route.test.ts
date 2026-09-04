/**
 * Presenter/booth dev-reset route for the exec skin, against the REAL store.
 *
 * Shape follows logistics' `route.test.ts`: exercise the real `data/store`
 * (never mocked) so the DATA half of a reset is asserted end to end, while the
 * MEMORY half's per-bucket fan-out is asserted separately below against a
 * mocked `global.fetch` — no `vi.mock` of the intelligence modules themselves,
 * so `SEED_MEMORIES`/`SEED_TARGET_USER_IDS`/`SEEDED_USER_IDS` stay the same
 * literals the route itself reads, and a change to those lists can't silently
 * turn an assertion here into a no-op.
 *
 * HERMETIC BY CONSTRUCTION: every case below stubs `INTELLIGENCE_API_URL`,
 * `CPK_INTELLIGENCE_API_KEY`, and `PRESENTER_RESET_ENABLED` explicitly rather
 * than relying on them being unset in the ambient shell. A machine with a real
 * Intelligence stack configured (or `PRESENTER_RESET_ENABLED=true` exported)
 * must not change what this suite does: the FORBIDDEN case must still 403
 * rather than silently 200, and the store-only case must never reach the
 * network and risk wiping a live memory store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/exec/data/store";
import { SEED_MEMORIES } from "@/skins/exec/intelligence/seed-memories";
import {
  DEMO_DEFAULT_USER_ID,
  SEED_TARGET_USER_IDS,
  SEEDED_USER_IDS,
} from "@/skins/exec/intelligence/user-id";

/**
 * `res.json()` throws an opaque `SyntaxError: Unexpected token ...` with no
 * indication of which response it came from when the body isn't valid JSON —
 * exactly the shape a stray 500/HTML error page produces. Reading the text
 * first turns that into a readable assertion failure that shows the actual
 * body instead of a bare parser error.
 */
async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Expected a JSON response body from POST /api/exec/v1/dev/reset, got: ${text}`,
    );
  }
}

beforeEach(() => store.reset());
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/exec/v1/dev/reset", () => {
  it("403s FORBIDDEN in production when presenter reset is disabled, and leaves the store untouched", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PRESENTER_RESET_ENABLED", "");
    // Unset explicitly: a host with a real Intelligence stack configured must
    // not change this into a network call — the 403 gate has to short-circuit
    // before either var is even read.
    vi.stubEnv("INTELLIGENCE_API_URL", "");
    vi.stubEnv("CPK_INTELLIGENCE_API_KEY", "");

    const [breach] = store.exceptions().filter((e) => !e.explained);
    store.fileNarrative({
      metricId: breach.metricId,
      period: breach.period,
      code: "VAR-TIMING",
      body: "Shipment timing shift.",
      source: "typed",
    });

    const res = await POST();

    expect(res.status).toBe(403);
    expect(await readJson(res)).toEqual({ error: "FORBIDDEN" });
    // The mutation survives — a refusal must not touch the store.
    expect(store.snapshot().narratives).toHaveLength(1);
  });

  it("resets the store back to seed when PRESENTER_RESET_ENABLED is set, even in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PRESENTER_RESET_ENABLED", "true");
    // Unset explicitly: with Intelligence configured this route also sweeps
    // and re-seeds memory over the network, which the fetch-isolation suite
    // below covers. A host with real Intelligence env exported must not turn
    // this store-only case into a live network call.
    vi.stubEnv("INTELLIGENCE_API_URL", "");
    vi.stubEnv("CPK_INTELLIGENCE_API_KEY", "");

    const [breach] = store.exceptions().filter((e) => !e.explained);
    store.fileNarrative({
      metricId: breach.metricId,
      period: breach.period,
      code: "VAR-TIMING",
      body: "Shipment timing shift.",
      source: "typed",
    });

    const res = await POST();

    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true, reset: ["store"] });
    // Seed state has no narratives — the filed one above is gone.
    expect(store.snapshot().narratives).toHaveLength(0);
  });
});

describe("POST /api/exec/v1/dev/reset — the memory half (fetch isolation)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sweeps every forget bucket and seeds every target bucket over a mocked network, never touching the real one", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PRESENTER_RESET_ENABLED", "true");
    vi.stubEnv("INTELLIGENCE_API_URL", "http://intelligence.invalid");
    vi.stubEnv("CPK_INTELLIGENCE_API_KEY", "cpk_test");
    // Unpinned, so the userId sets below resolve to the static lists rather
    // than collapsing everything into one pinned bucket.
    vi.stubEnv("INTELLIGENCE_USER_ID", "");

    const calls: Array<{ method: string; url: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push({ method, url });

      if (method === "GET" && url.endsWith("/api/memories")) {
        // No rows to delete: keeps this test focused on fan-out coverage
        // rather than the DELETE path, which forget-memories.ts already
        // covers on its own.
        return new Response(JSON.stringify({ memories: [] }), {
          status: 200,
        });
      }
      if (method === "POST" && url.endsWith("/api/memories")) {
        // Every seed POST fails on the mocked network. This is what proves
        // `seedMemories` never reached anything real: no assertion here
        // depends on a live backend being reachable.
        return new Response("", { status: 500 });
      }
      throw new Error(`unexpected fetch in test: ${method} ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await POST();
    const body = await readJson(res);

    // One list call per distinct forget bucket — SEEDED_USER_IDS +
    // DEMO_DEFAULT_USER_ID, deduped, matching route.ts's `userIds` set.
    const expectedForgetBuckets = new Set([
      ...SEEDED_USER_IDS,
      DEMO_DEFAULT_USER_ID,
    ]);
    const forgetCalls = calls.filter((c) => c.method === "GET");
    expect(forgetCalls).toHaveLength(expectedForgetBuckets.size);

    // One POST per seed memory per seed target bucket.
    const seedCalls = calls.filter((c) => c.method === "POST");
    expect(seedCalls).toHaveLength(
      SEED_TARGET_USER_IDS.length * SEED_MEMORIES.length,
    );

    // The mock is the only thing that answered — nothing here can have
    // reached a real Intelligence backend.
    expect(fetchMock).toHaveBeenCalledTimes(
      forgetCalls.length + seedCalls.length,
    );

    // KNOWN GAP, tracked and owned separately (not fixed in this test file):
    // every seed POST above failed, `seeded` is 0, and the route still
    // reports `ok: true`. This assertion pins the route's CURRENT behavior
    // so the fetch-isolation coverage this test adds doesn't silently start
    // asserting the honesty fix too — it is not an endorsement of "seeded: 0
    // is success".
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      reset: ["store", "memory"],
      forgot: 0,
      seeded: 0,
    });
  });
});
