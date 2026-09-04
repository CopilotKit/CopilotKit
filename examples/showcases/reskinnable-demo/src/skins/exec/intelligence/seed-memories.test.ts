/**
 * HERMETIC BY CONSTRUCTION: every case stubs `global.fetch`, and the teardown
 * un-stubs it. No case reads an `INTELLIGENCE_*` env var — `seedMemories` takes
 * its backend address as a parameter — so a developer with a real Intelligence
 * stack configured cannot make this suite POST seed memories into it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEED_MEMORIES, seedMemories } from "./seed-memories";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const API = {
  apiUrl: "http://intelligence.invalid:7450",
  apiKey: "cpk_test",
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

  it("aborts a hung POST within the timeout and counts it as not stored", async () => {
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
    vi.spyOn(console, "error").mockImplementation(() => {});

    const started = Date.now();
    const stored = await seedMemories({ ...API, timeoutMs: 30 });

    expect(stored).toBe(0);
    // Bounded: without a signal this promise never settles and the reset spins.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(console.error).toHaveBeenCalled();
  });

  it("counts a rejected seed as not stored and never throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 201 }))
        .mockResolvedValue(new Response("nope", { status: 500 })),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Never throws — `dev/reset` compares the count instead of catching.
    await expect(seedMemories(API)).resolves.toBe(1);
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

  it("never seeds beat 6's publish-unlock procedure", () => {
    // Seed it and the teach arc disappears. See rule 3 in the file header.
    for (const memory of SEED_MEMORIES) {
      expect(memory.content).not.toMatch(/UNEXPLAINED_VARIANCE/);
      expect(memory.content).not.toMatch(/VAR-[A-Z]+/);
    }
  });
});
