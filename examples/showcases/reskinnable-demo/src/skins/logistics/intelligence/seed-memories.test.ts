import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { seedMemories, SEED_MEMORIES } from "./seed-memories";

afterEach(() => vi.restoreAllMocks());

const API = {
  apiUrl: "http://x:7450",
  apiKey: "k",
  userId: "meridian-demo-user",
};

describe("seedMemories", () => {
  it("stores every seed memory and bounds each request with an AbortSignal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const stored = await seedMemories(API);

    expect(stored).toBe(SEED_MEMORIES.length);
    expect(fetchMock.mock.calls).toHaveLength(SEED_MEMORIES.length);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe("http://x:7450/api/memories");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
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
});

/**
 * WHAT IS SEEDED — the assertions that are about the DEMO rather than the HTTP.
 *
 * Every one of these fails silently in production: a seed file that stores
 * cleanly and says the wrong thing still returns `ok: true`, still renders, and
 * costs a beat on stage. None of them is checkable by a type.
 */
describe("the seeded memories themselves", () => {
  const beat4 = SEED_MEMORIES.find((m) => m.kind === "topical");
  const beat5 = SEED_MEMORIES.find((m) => m.kind === "operational");

  it("seeds one preference for beat 4 and one procedure for beat 5", () => {
    expect(beat4).toBeDefined();
    expect(beat5).toBeDefined();
  });

  it("keeps everything at user scope, never project", () => {
    // A project-scoped row is returned for EVERY user id in this backend, so it
    // would surface inside the other five skins' demos — and the presenter reset
    // deliberately does not delete project rows, so it would also survive a
    // reset. See forget-memories.ts.
    for (const memory of SEED_MEMORIES) expect(memory.scope).toBe("user");
  });

  it("tells the beat-5 procedure to run without asking for confirmation", () => {
    // Rule 2 in the seed file's header: a procedure that stops for a
    // confirmation card can be abandoned mid-run, and the NEXT message then
    // fails the whole thread with "Tool result is missing for tool call …".
    expect(beat5?.content).toMatch(/without asking for confirmation/i);
  });

  it("says in its own text that beat 5 is NOT beat 6's procedure", () => {
    expect(beat5?.content).toMatch(/not the procedure/i);
    expect(beat5?.content).toMatch(/do not confuse/i);
    expect(beat5?.content).toMatch(/not offer to record/i);
  });

  it("does NOT seed beat 6's unlock vocabulary", () => {
    // The whole teach arc depends on the agent NOT knowing which code lifts the
    // authority gate. The seed file is the one channel `eslint.config.mjs`'s
    // `withheldGateVocabulary` rule cannot see, because it is prose in a data
    // literal rather than an identifier.
    const blob = SEED_MEMORIES.map((m) => m.content).join(" ");
    for (const code of [
      "CUSTOMER_COMMITMENT",
      "LINE_DOWN_RISK",
      "REGULATORY_DEADLINE",
      "COST_AVOIDANCE",
      "PEAK_SEASON",
      "INTERNAL_CONVENIENCE",
    ]) {
      expect(blob).not.toContain(code);
    }
    // Nor the mechanism by another name — "file an escalation under <x>" would
    // hand over the shape of the answer even without a literal code.
    expect(blob).not.toMatch(/escalation/i);
  });

  it("names only tools that exist in tools.tsx", () => {
    // The procedure names its three writes as LITERAL STRINGS, so a tool rename
    // breaks beat 5 with no compiler, no lint and no other test noticing. This
    // is the guard for that.
    const tools = readFileSync(path.join(__dirname, "..", "tools.tsx"), "utf8");
    const named = [...(beat5?.content.matchAll(/\bcall (\w+)/g) ?? [])].map(
      (m) => m[1],
    );
    expect(named).toEqual([
      "raiseShipmentWatch",
      "notifyCarrier",
      "postShipmentNote",
    ]);
    for (const tool of named) expect(tools).toContain(`name: "${tool}"`);
  });

  it("names three separate, checkable behaviours in the beat-4 preference", () => {
    // A single-clause preference reads as a coincidence from the back of a room.
    // Each of these maps to one flag on `showExceptionSummary`.
    expect(beat4?.content).toMatch(/by LANE/);
    expect(beat4?.content).toMatch(/promised/i);
    expect(beat4?.content).toMatch(/thousands/i);
    // And it must ask to be SURFACED — the "why" slot is the beat.
    expect(beat4?.content).toMatch(/say which preference you applied/i);
  });
});
