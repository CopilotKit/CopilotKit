/**
 * The presenter reset's ONE job is to guarantee a known-good starting state, so
 * the thing worth testing hardest is not that it works — it is that it REFUSES
 * to say it worked when it did not.
 *
 * The bug these tests pin: `seedMemories` never throws (it counts stored rows and
 * logs the rest), so the route used to fall out of its try block and answer
 * `ok: true, reset: ["store", "memory"]` even when the memory backend had
 * rejected every POST. `seeded: 0` sat in the body, unread, while the presenter
 * walked on stage believing beats 4/5 were armed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/skins/commerce/data/store", () => ({ reset: vi.fn() }));
vi.mock("@/skins/commerce/intelligence/forget-memories", () => ({
  forgetAllMemories: vi.fn(),
}));
// Only `seedMemories` is faked. `SEED_MEMORIES` stays REAL so the expected count
// this suite compares against is derived from the same literal the route reads —
// adding a seed memory must not silently turn these assertions into no-ops.
vi.mock(
  "@/skins/commerce/intelligence/seed-memories",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/skins/commerce/intelligence/seed-memories")
    >()),
    seedMemories: vi.fn(),
  }),
);

import * as store from "@/skins/commerce/data/store";
import { forgetAllMemories } from "@/skins/commerce/intelligence/forget-memories";
import {
  SEED_MEMORIES,
  seedMemories,
} from "@/skins/commerce/intelligence/seed-memories";
import {
  memoryScopeUserIds,
  memorySeedTargetUserIds,
} from "@/skins/commerce/intelligence/user-id";
import { POST } from "./route";

beforeEach(() => {
  // Silence the route's own reset logging without losing a real failure.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Re-established per test rather than in the `vi.mock` factory: the factory
  // runs once, and `restoreAllMocks` in afterEach strips a factory-set
  // implementation — after which `forgetAllMemories` resolves `undefined`, the
  // route throws on `result.forgot`, and EVERY case lands in the catch path
  // returning a 502 that looks exactly like the failure being asserted.
  // `complete: true` is the DEFAULT for the same reason the implementation had to
  // start reporting it: a sweep that returns having stepped over failures is not a
  // finished sweep, and every case below except the two that assert otherwise is
  // about a wipe that genuinely emptied its bucket.
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

describe("POST /api/commerce/v1/dev/reset", () => {
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

  it("does NOT report ok/memory-reset when the WIPE could not prove it finished", async () => {
    // The other half of the same question, and the more dangerous half. A short
    // SEED leaves a beat unarmed and visibly quiet. A memory the wipe MISSED
    // leaves the demo already knowing something — so beat 6 can look taught
    // before anyone taught it, which reads as success and proves nothing.
    // `forgetAllMemories` no longer aborts on a bad row, so returning normally
    // stopped implying that it finished; the route has to read `complete`.
    configureIntelligence();
    vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);
    vi.mocked(forgetAllMemories).mockResolvedValue({
      forgot: 1,
      alreadyGone: 0,
      skippedProjectScoped: 0,
      failed: [{ id: "mem-7", reason: "HTTP 500" }],
      passes: 3,
      complete: false,
      incompleteReason: "still deletable after 3 passes",
    });

    const res = await POST();

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, reset: ["store"] });
    // A fully-seeded run must NOT be able to launder an unfinished wipe into a
    // "seeded" verdict.
    expect(body.memory).not.toBe("seeded");
    // Summed ACROSS buckets, not per bucket: the stub answers for every identity
    // in the scope set, so one failed row per bucket is one failure per bucket.
    // Asserted as an accumulation rather than a literal, so the number of seeded
    // operators stays free to change.
    expect(body.forgetFailures).toBe(body.forgetShortfalls.length);
    expect(body.forgetFailures).toBeGreaterThan(0);
    expect(body.memoryError).toMatch(/wipe did not finish/i);
    // The reason survives to the response, per bucket, or a presenter cannot tell
    // which identity is dirty.
    expect(body.forgetShortfalls.join(" ")).toContain(
      "still deletable after 3 passes",
    );
  });

  it("counts an already-absent row as forgotten without inflating `forgot`", async () => {
    configureIntelligence();
    vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);
    vi.mocked(forgetAllMemories).mockResolvedValue({
      forgot: 1,
      alreadyGone: 4,
      skippedProjectScoped: 0,
      failed: [],
      passes: 2,
      complete: true,
    });

    const res = await POST();

    // A 404 on delete means the row is gone, which is all the reset needs — so
    // this is success, and `alreadyGone` is reported separately so `forgot` stays
    // literally true rather than being padded to look better.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, memory: "seeded" });
    expect(body.forgot).toBeGreaterThan(0);
    expect(body.alreadyGone).toBeGreaterThan(0);
  });

  it("does NOT report ok/memory-reset when every seed POST failed", async () => {
    configureIntelligence();
    const expected = memorySeedTargetUserIds().length * SEED_MEMORIES.length;
    // Exactly the real helper's total-failure shape: it swallows every rejection
    // and returns 0 stored. Nothing throws, so only the count can catch this.
    vi.mocked(seedMemories).mockResolvedValue(0);

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.memory).toBe("failed");
    // The load-bearing assertion: "memory" must be absent from `reset`. A wipe
    // with no re-seed leaves beats 4/5 unarmed.
    expect(body.reset).toEqual(["store"]);
    expect(body.seeded).toBe(0);
    expect(body.expectedSeeds).toBe(expected);
    expect(body.memoryError).toContain("beats 4/5 are not armed");
    // The ledger genuinely WAS restored; the body must still say so.
    expect(store.reset).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a partial seed from a total failure", async () => {
    configureIntelligence();
    const targets = memorySeedTargetUserIds();
    // Guard the premise: a partial case only exists with >1 bucket or >1 memory.
    expect(targets.length * SEED_MEMORIES.length).toBeGreaterThan(1);
    // First bucket fully seeded, the rest rejected — the mid-loop shortfall.
    vi.mocked(seedMemories)
      .mockResolvedValueOnce(SEED_MEMORIES.length)
      .mockResolvedValue(0);

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.memory).toBe("partial");
    expect(body.reset).toEqual(["store"]);
    expect(body.seeded).toBe(SEED_MEMORIES.length);
    expect(body.expectedSeeds).toBe(targets.length * SEED_MEMORIES.length);
  });

  it("scales the expectation to the collapsed bucket set when the user id is pinned", async () => {
    configureIntelligence();
    // A pinned id collapses every scope onto one bucket (Playwright pins one), so
    // the expectation must shrink with it. A hardcoded expected count would fail
    // a perfectly good reset here.
    vi.stubEnv("INTELLIGENCE_USER_ID", "pinned-bucket");
    vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);

    const res = await POST();

    expect(res.status).toBe(200);
    expect(seedMemories).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({
      ok: true,
      memory: "seeded",
      expectedSeeds: SEED_MEMORIES.length,
    });
  });

  /**
   * The catch path — the one nobody exercises until it fires at a booth, and the
   * moment a presenter most needs the truth. It used to infer memory state from
   * `forgot` alone (`reset: forgot > 0 ? ["store","memory"] : ["store"]`) and drop
   * every other counter, so it told BOTH lies available to it: memory reset when
   * only the wipe had run, and memory untouched when the sweep had run over
   * legitimately empty buckets.
   */
  describe("when the sequence throws part-way through", () => {
    /** A bucket that genuinely had nothing to forget — a second reset in a row. */
    const emptyBucket = {
      forgot: 0,
      alreadyGone: 0,
      skippedProjectScoped: 0,
      failed: [],
      passes: 1,
      complete: true,
    } as const;

    it("does NOT imply memory was untouched when an EMPTY first bucket was swept", async () => {
      configureIntelligence();
      const scope = memoryScopeUserIds();
      // Premise: a mid-loop throw needs a bucket after the first one.
      expect(scope.length).toBeGreaterThan(1);
      vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);
      vi.mocked(forgetAllMemories)
        .mockResolvedValueOnce({ ...emptyBucket, failed: [] })
        .mockRejectedValue(
          new Error(
            "[commerce/forget-memories] list memories failed: 503 nope",
          ),
        );

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.reset).toEqual(["store"]);
      // The load-bearing pair: `forgot === 0` is TRUE and says nothing, so the
      // response has to report that a sweep ran anyway. Reading memory state off
      // `forgot` is what made an empty bucket indistinguishable from no sweep.
      expect(body.forgot).toBe(0);
      expect(body.bucketsSwept).toBe(1);
      expect(body.bucketsToSweep).toBe(scope.length);
      expect(body.memory).toBe("partial");
      expect(body.memoryError).toContain("wipe phase");
      expect(body.memoryError).toContain("503 nope");
      // The throw aborted before seeding, and the body must say so rather than
      // omitting the field.
      expect(body.seeded).toBe(0);
      expect(body.bucketsSeeded).toBe(0);
      expect(seedMemories).not.toHaveBeenCalled();
    });

    it("does NOT claim memory was reset when the wipe finished but seeding threw", async () => {
      configureIntelligence();
      const scope = memoryScopeUserIds();
      const targets = memorySeedTargetUserIds();
      // The wipe half succeeds everywhere (default stub forgets 2 per bucket) and
      // the seed half never lands a single row. `forgot > 0` used to be enough to
      // report `reset: ["store","memory"]` here — memory armed, on stage, empty.
      vi.mocked(seedMemories).mockRejectedValue(
        new Error("seed POST exploded"),
      );

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.reset).toEqual(["store"]);
      expect(body.reset).not.toContain("memory");
      expect(body.memory).toBe("partial");
      expect(body.forgot).toBeGreaterThan(0);
      expect(body.bucketsSwept).toBe(scope.length);
      expect(body.seeded).toBe(0);
      expect(body.bucketsSeeded).toBe(0);
      expect(body.expectedSeeds).toBe(targets.length * SEED_MEMORIES.length);
      expect(body.memoryError).toContain("seed phase");
      expect(body.memoryError).toContain("seed POST exploded");
    });

    it("reports the counters the loops actually reached when seeding throws mid-loop", async () => {
      configureIntelligence();
      const targets = memorySeedTargetUserIds();
      // Premise: a mid-seed throw needs a target after the first one.
      expect(targets.length).toBeGreaterThan(1);
      vi.mocked(forgetAllMemories).mockResolvedValue({
        forgot: 3,
        alreadyGone: 1,
        skippedProjectScoped: 2,
        failed: [],
        passes: 2,
        complete: true,
      });
      vi.mocked(seedMemories)
        .mockResolvedValueOnce(SEED_MEMORIES.length)
        .mockRejectedValue(new Error("seed POST exploded"));

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      // Every accumulator, as measured: one target seeded, the rest never ran.
      expect(body.seeded).toBe(SEED_MEMORIES.length);
      expect(body.bucketsSeeded).toBe(1);
      expect(body.forgot).toBe(3 * memoryScopeUserIds().length);
      expect(body.alreadyGone).toBe(1 * memoryScopeUserIds().length);
      // MAX across buckets, not a sum: the same global project-scoped rows come
      // back for every user id, so summing would report N× the truth.
      expect(body.skippedProjectScoped).toBe(2);
      expect(body.forgetFailures).toBe(0);
      expect(body.forgetShortfalls).toEqual([]);
      expect(body.memory).toBe("partial");
    });

    it("reports `failed` when the very first sweep threw, so nothing landed", async () => {
      configureIntelligence();
      vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);
      vi.mocked(forgetAllMemories).mockRejectedValue(
        new Error(
          "[commerce/forget-memories] list memories failed: ECONNREFUSED",
        ),
      );

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.reset).toEqual(["store"]);
      expect(body.memory).toBe("failed");
      expect(body.bucketsSwept).toBe(0);
      expect(body.forgot).toBe(0);
      expect(body.seeded).toBe(0);
      // The ledger genuinely WAS restored before the memory work began.
      expect(store.reset).toHaveBeenCalledTimes(1);
    });

    it("surfaces a swept bucket that could not prove it was emptied", async () => {
      configureIntelligence();
      expect(memoryScopeUserIds().length).toBeGreaterThan(1);
      vi.mocked(forgetAllMemories)
        .mockResolvedValueOnce({
          forgot: 1,
          alreadyGone: 0,
          skippedProjectScoped: 0,
          failed: [{ id: "mem-7", reason: "HTTP 500" }],
          passes: 3,
          complete: false,
          incompleteReason: "1 row(s) failed to delete",
        })
        .mockRejectedValue(new Error("list memories failed: 503"));

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      // A row the wipe missed can leave beat 6 already taught, so the shortfall
      // must survive into the error body rather than being dropped with the rest
      // of the try's progress.
      expect(body.forgetFailures).toBe(1);
      expect(body.forgetShortfalls.join(" ")).toContain(
        "1 row(s) failed to delete",
      );
      expect(body.memoryError).toMatch(/could not prove they were emptied/i);
    });
  });

  /**
   * The route's gate (`PRESENTER_RESET_ENABLED`, or any non-production env) is a
   * demo convenience, NOT an authorization boundary: a booth deployment that
   * sets it answers this POST for anyone who can reach the box. So no
   * Intelligence SECRET may travel in the body — the address used to, as
   * `apiUrl`, in EVERY response, success and failure alike.
   *
   * The address was the FIRST secret this body leaked, never the only one. Every
   * free-text field here is backend-derived (`forgetShortfalls` quotes the
   * backend's own response body; `memoryError` embeds an arbitrary
   * `Error.message`), so a 401 payload echoing the API KEY, or a transport error
   * naming the gateway, lands in the body by the identical route. The first
   * redactor knew about the URL alone, which is why these cases assert the whole
   * secret set rather than one value.
   *
   * Each case asserts the WHOLE serialized body rather than one field, so adding
   * a field that happens to carry a secret cannot slip past, and pairs that with
   * what the presenter must still be told: the log keeps the detail, the body
   * keeps the diagnosis.
   */
  describe("Intelligence secrets", () => {
    /** Distinctive on purpose: a substring assertion against `localhost` proves little. */
    const BACKEND = "http://memory.internal.example:7250";
    /** `URL.host` — WITH the port. */
    const HOST = "memory.internal.example:7250";
    /**
     * `URL.hostname` — WITHOUT the port, and the form the first needle set
     * missed. It only ever passed before because every fixture quoted the
     * hostname as part of the full URL, where redacting the URL took it along.
     */
    const HOSTNAME = "memory.internal.example";
    /** Shaped like the real thing (see .env.example) so length ordering is realistic. */
    const API_KEY = "cpk_s2PRVSED_seed0privat0longtoken01";
    /** A DIFFERENT host, so covering the gateway is proven independently. */
    const WS_URL = "ws://gateway.internal.example:7253";

    function configureNamedBackend() {
      configureIntelligence();
      vi.stubEnv("INTELLIGENCE_API_URL", BACKEND);
      vi.stubEnv("INTELLIGENCE_API_KEY", API_KEY);
      vi.stubEnv("INTELLIGENCE_GATEWAY_WS_URL", WS_URL);
    }

    /**
     * Asserted on the serialized body, so a NEW field cannot reintroduce the
     * leak — and against EVERY secret, so a redactor that covers some of them
     * cannot pass. The URL half of this list was here from the start; the key
     * and the gateway are what the first redactor could not have removed,
     * because it was never handed them.
     */
    function expectNoSecrets(body: unknown) {
      const serialized = JSON.stringify(body);
      for (const secret of [BACKEND, HOST, HOSTNAME, API_KEY, WS_URL]) {
        expect(serialized).not.toContain(secret);
      }
    }

    const loggedText = (spy: typeof console.warn | typeof console.error) =>
      vi.mocked(spy).mock.calls.flat().map(String).join("\n");

    it("stays out of a successful reset's body while the log still names the backend", async () => {
      configureNamedBackend();
      vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ ok: true, memory: "seeded" });
      expectNoSecrets(body);
      // The deliberate pre-mutation warning is the one place it belongs: several
      // demos in this repo vendor the same stack, so a human needs to see which
      // backend was about to be touched.
      expect(loggedText(console.warn)).toContain(BACKEND);
    });

    it("stays out of a shortfall body, which still names the dirty identity", async () => {
      configureNamedBackend();
      vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);
      // The backend quoting its OWN address in an error body is why the reason is
      // redacted rather than merely omitted from a field of this route's own text.
      vi.mocked(forgetAllMemories).mockResolvedValue({
        forgot: 1,
        alreadyGone: 0,
        skippedProjectScoped: 0,
        failed: [{ id: "mem-7", reason: "HTTP 500" }],
        passes: 3,
        complete: false,
        incompleteReason: `HTTP 500 from ${BACKEND}/api/memories`,
      });

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      expectNoSecrets(body);
      // The presenter is still told enough to act: memory failed, which half,
      // which bucket, and that a survivor can leave beat 6 already taught.
      expect(body.memory).not.toBe("seeded");
      expect(body.memoryError).toMatch(/wipe did not finish/i);
      expect(body.forgetShortfalls.join(" ")).toContain("HTTP 500");
      expect(body.forgetShortfalls.join(" ")).toContain(
        memoryScopeUserIds()[0],
      );
      // Redaction leaves a marker rather than a hole, so the reason still reads.
      expect(body.forgetShortfalls.join(" ")).toContain(
        "<intelligence-backend>",
      );
    });

    it("stays out of the interrupted body even when the CAUSE quotes the address", async () => {
      configureNamedBackend();
      vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);
      // Undici's own wording for a malformed backend env names the address
      // verbatim, and `memoryError` embeds the cause message unchanged.
      vi.mocked(forgetAllMemories).mockRejectedValue(
        new Error(`Failed to parse URL from ${BACKEND}/api/memories`),
      );

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      expectNoSecrets(body);
      // Everything the presenter acts on survives: the phase, the counters, the
      // cause's wording, and the fact that memory is not armed.
      expect(body.memory).toBe("failed");
      expect(body.reset).toEqual(["store"]);
      expect(body.memoryError).toContain("wipe phase");
      expect(body.memoryError).toContain("Failed to parse URL");
      expect(body.memoryError).toContain("<intelligence-backend>");
      // And the log — what the sidebar button tells the presenter to read — keeps
      // the address it was redacted out of the response.
      expect(loggedText(console.error)).toContain(BACKEND);
    });

    it("removes the host named WITHOUT its port", async () => {
      configureNamedBackend();
      vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);
      // A scheme-less env, a proxy error, or a DNS failure names the bare
      // hostname with no port and no scheme — a form neither the raw URL needle
      // nor `URL.host` contains, so redacting those two leaves it in the body.
      vi.mocked(forgetAllMemories).mockRejectedValue(
        new Error(`getaddrinfo ENOTFOUND ${HOSTNAME}`),
      );

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      expectNoSecrets(body);
      expect(body.memoryError).toContain("ENOTFOUND");
      expect(body.memoryError).toContain("<intelligence-backend>");
    });

    it("removes the API KEY when the backend echoes it back", async () => {
      configureNamedBackend();
      vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);
      // `forgetAllMemories` puts the backend's own response text into its
      // reasons (`HTTP ${status} ${await safeText(res)}`), and an auth failure is
      // exactly the response that quotes the credential it rejected. The key is
      // WORSE in a body than the address: the address only says where the stack
      // is, the key opens it.
      vi.mocked(forgetAllMemories).mockResolvedValue({
        forgot: 0,
        alreadyGone: 0,
        skippedProjectScoped: 0,
        failed: [{ id: "mem-7", reason: "HTTP 401" }],
        passes: 1,
        complete: false,
        incompleteReason: `HTTP 401 {"error":"invalid api key ${API_KEY}"}`,
      });

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      expectNoSecrets(body);
      // Diagnosable without the credential: the status and the marker survive.
      expect(body.forgetShortfalls.join(" ")).toContain("HTTP 401");
      expect(body.forgetShortfalls.join(" ")).toContain(
        "<intelligence-api-key>",
      );
    });

    it("removes the gateway WS URL when a cause quotes it", async () => {
      configureNamedBackend();
      vi.mocked(seedMemories).mockResolvedValue(SEED_MEMORIES.length);
      // Reachable the same way every other secret is: this route composes none
      // of this text. The gateway is a second internal address the same
      // deployment exposes, so a redactor scoped to the REST URL alone publishes
      // it the moment any upstream message names it.
      vi.mocked(forgetAllMemories).mockRejectedValue(
        new Error(`connect ECONNREFUSED ${WS_URL}`),
      );

      const res = await POST();
      const body = await res.json();

      expect(res.status).toBe(502);
      expectNoSecrets(body);
      expect(body.memoryError).toContain("ECONNREFUSED");
      expect(body.memoryError).toContain("<intelligence-gateway>");
    });
  });
});
