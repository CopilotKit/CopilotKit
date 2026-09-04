/**
 * HERMETIC BY CONSTRUCTION: every case stubs `global.fetch`, and the teardown
 * un-stubs it. `seedMemories` takes its backend address as a PARAMETER, so a
 * developer with a real Intelligence stack configured cannot make this suite
 * POST seed memories into it.
 *
 * The `INTELLIGENCE_*` / `CPK_*` vars are stubbed to fixtures anyway, because
 * the failure log runs the backend's response body through `redactSecrets`,
 * which derives its needle set from the AMBIENT environment. Left unstubbed, a
 * developer with a real key exported would be redacting against a different
 * needle set than CI — a suite that passes or fails depending on whose shell it
 * runs in. The teardown un-stubs them so nothing leaks into the next file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEED_MEMORIES, seedMemories } from "./seed-memories";

const BACKEND = "http://intelligence.invalid:7450";
const API_KEY = "cpk_test";

beforeEach(() => {
  vi.stubEnv("INTELLIGENCE_API_URL", BACKEND);
  vi.stubEnv("CPK_INTELLIGENCE_API_KEY", API_KEY);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const API = {
  apiUrl: BACKEND,
  apiKey: API_KEY,
  userId: "vantage-demo-user",
};

describe("seedMemories", () => {
  it("POSTs every seed memory to the right URL with auth, identity and a bounded signal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const stored = await seedMemories(API);

    expect(stored).toBe(SEED_MEMORIES.length);
    expect(fetchMock.mock.calls).toHaveLength(SEED_MEMORIES.length);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe("http://intelligence.invalid:7450/api/memories");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer cpk_test",
        "X-Cpki-User-Id": "vantage-demo-user",
        "Content-Type": "application/json",
      });
      // The defect: an unbounded POST leaves the presenter's Reset button
      // spinning forever against a wedged backend.
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    // Every seeded row is user-scoped; a project-scoped one would survive
    // every reset forever. See the type comment in seed-memories.ts.
    const bodies = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    for (const body of bodies) expect(body.scope).toBe("user");
  });

  it("trims a trailing slash off the backend address rather than doubling it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await seedMemories({ ...API, apiUrl: "http://intelligence.invalid:7450/" });

    for (const [url] of fetchMock.mock.calls) {
      expect(url).toBe("http://intelligence.invalid:7450/api/memories");
    }
  });

  /**
   * A `Date.now() < 2000` bound asserted nothing reachable: if the signal were
   * dropped, this promise would NEVER settle and the case would die as a vitest
   * timeout long before reaching the assertion. What actually needs pinning is
   * that the CALLER's `timeoutMs` is the one that fired, and that the log names
   * the abort — otherwise a hung seed is a silent zero in `dev/reset`'s count.
   */
  it("aborts a hung POST on the caller's timeout, counts it as not stored, and says so", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason ?? new Error("aborted")),
            );
          }),
      ),
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const stored = await seedMemories({ ...API, timeoutMs: 30 });

    expect(stored).toBe(0);
    // One line per seed that did not land, each naming the bucket and the
    // reason — a real `AbortSignal.timeout`, not a signal that never fires.
    expect(logged).toHaveBeenCalledTimes(SEED_MEMORIES.length);
    const line = String(logged.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("vantage-demo-user");
    expect(line).toContain("TimeoutError");
  });

  /**
   * THE DEFECT: a rejected seed logged the STATUS and threw the response body
   * away. `422 MEMORY_VALIDATION_ERROR: scope must be one of …` and a bare
   * `HTTP 422` are the same line to whoever is reading the server log, and only
   * one of them says which field to fix — so beats 4/5 stay unarmed while the
   * only clue sits in a body nobody kept.
   */
  it("logs the backend's rejection body, not just the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            `MEMORY_VALIDATION_ERROR: kind must be one of topical|episodic ` +
              `(key ${API_KEY} at ${BACKEND})`,
            { status: 422 },
          ),
        ),
      ),
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(seedMemories(API)).resolves.toBe(0);

    const line = String(logged.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("422");
    expect(line).toContain("MEMORY_VALIDATION_ERROR");
    expect(line).toContain("kind must be one of");
    // The body is UNTRUSTED upstream text and can quote our own credentials
    // back at us, so it goes through `redactSecrets` on the way to the log.
    expect(line).not.toContain(API_KEY);
    expect(line).not.toContain(BACKEND);
  });

  it("counts a rejected seed as not stored and never throws", async () => {
    // A fresh Response per call: one instance shared across calls has a body
    // that can only be read once, so the second read of `nope` would throw.
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        call += 1;
        return Promise.resolve(
          call === 1
            ? new Response("", { status: 201 })
            : new Response("nope", { status: 500 }),
        );
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Never throws — `dev/reset` compares the count instead of catching.
    // Derived, not `1`: the roster is a literal that can grow, and only the
    // FIRST POST is stubbed to succeed.
    await expect(seedMemories(API)).resolves.toBe(
      Math.min(SEED_MEMORIES.length, 1),
    );
  });
});

describe("SEED_MEMORIES content", () => {
  const procedure = SEED_MEMORIES.find((m) => m.kind === "operational");

  it("carries the beat-5 board-pack procedure", () => {
    expect(procedure).toBeDefined();
    expect(procedure!.content).toContain("board pack");
  });

  /**
   * THE DEFECT: the seeded procedure used to say "Run all steps immediately",
   * which reads as "emit every step in one turn" and fights prompt rule 4 in
   * `src/skins/exec/agent.ts` — ONE BLOCK AT A TIME, never two render calls in
   * the same turn, because two blocks composed in the same turn collide and the
   * second REPLACES the first. A memory that contradicts the prompt is the
   * worse of the two on stage: recall is the thing the beat is showing off, so
   * the agent follows it and the room watches three renders become one block.
   *
   * The no-confirmation property still has to survive the rewording — see rule
   * 2 in the file header: a procedure that opens a confirmation card mid-run
   * can be left unresolved by a presenter who moves on, which fails the NEXT
   * message with "Tool result is missing for tool call ...".
   */
  it("tells the agent to run the steps one call per turn, not all at once", () => {
    expect(procedure!.content).not.toMatch(/run all (the )?steps/i);
    expect(procedure!.content).toMatch(/one (tool )?call per turn/i);
    expect(procedure!.content).toMatch(/in order/i);
  });

  it("still forbids pausing for confirmation between steps", () => {
    expect(procedure!.content).toMatch(/without (asking|pausing)/i);
  });

  /**
   * THE GUARD'S OWN DEFECT: it grepped for two magic strings
   * (`UNEXPLAINED_VARIANCE`, a `VAR-…` code) and nothing else, so beat 6's
   * procedure written in PROSE — "if publishing is refused, file a narrative
   * against the offending line under a justifying code, then publish again" —
   * sailed straight through it, the agent started out already knowing the
   * answer, and the teach arc disappeared. Seeding it is the one thing this
   * file must never do (rule 3 in the header), so the guard is anchored to the
   * SHAPE of a seeded procedure, not to two spellings of it.
   */
  it("never seeds beat 6's publish-unlock procedure, in symbols or in prose", () => {
    // Symbols first — the exact identifiers the ledger uses.
    for (const memory of SEED_MEMORIES) {
      expect(memory.content).not.toMatch(/UNEXPLAINED_VARIANCE/);
      expect(memory.content).not.toMatch(/VAR-[A-Z]+/);
    }

    // Structure: a seeded PROCEDURE is a stepwise list. There must be exactly
    // one, and it must be the board-pack one — a prose beat-6 recipe would show
    // up here as a second stepwise memory (or as steps grafted onto this one).
    const stepwise = SEED_MEMORIES.filter((m) => /\(1\)/.test(m.content));
    expect(stepwise).toEqual([procedure]);

    // Semantics: the publish-unlock subject may appear ONLY as the beat-5
    // memory's disclaimer telling the agent not to confuse the two, never as
    // something to do.
    const PUBLISH_UNLOCK =
      /variance narrative|publish[- ]unlock|publish refusal|justif\w* code/i;
    for (const memory of SEED_MEMORIES) {
      if (!PUBLISH_UNLOCK.test(memory.content)) continue;
      expect(memory.content).toMatch(/not the publish-unlock procedure/i);
      expect(memory.content).toMatch(/do not confuse/i);
      expect(memory.content).toMatch(/do not offer to record/i);
    }
  });
});
