import { describe, it, expect, vi, afterEach } from "vitest";
import { seedMemories, SEED_MEMORIES } from "./seed-memories";
import { VARIANCE_CODES } from "@/skins/keel/data/variance-codes";
import {
  REVIEW_FLAG_REASONS,
  OWNER_NOTICE_TEMPLATES,
} from "@/skins/keel/data/handling";

afterEach(() => vi.restoreAllMocks());

const API = {
  apiUrl: "http://x:7450",
  apiKey: "k",
  userId: "keel-sam-okafor",
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
 * The seed CONTENT, which is the part with no other guard at all. Every assertion
 * below is a demo failure that compiles, lints and looks perfect on stage.
 */
describe("what is seeded, and what is deliberately not", () => {
  it("seeds exactly two memories — the beat-4 preference and the beat-5 procedure", () => {
    expect(SEED_MEMORIES).toHaveLength(2);
    expect(SEED_MEMORIES.map((m) => m.kind)).toEqual([
      "topical",
      "operational",
    ]);
  });

  it("scopes BOTH at user, never project", () => {
    // `forget-memories.ts` deliberately SKIPS project-scoped rows, because project
    // scope is global to the shared Intelligence instance and sweeping it would
    // destroy banking's seeded memories. So a project-scoped row here would survive
    // every presenter reset — for beat 5 that is merely redundant, but it is the
    // same mechanism that would leave beat 6 already taught, and one rule for both
    // is the only rule anyone remembers.
    for (const memory of SEED_MEMORIES) {
      expect(memory.scope).toBe("user");
    }
  });

  it("states the beat-4 preference as four CHECKABLE behaviours", () => {
    // The beat is only visible if a reader in the room can verify the answer
    // changed. A one-clause preference reads as a coincidence.
    const beat4 = SEED_MEMORIES[0].content;
    expect(beat4).toContain("KNOWLEDGE SPACE");
    expect(beat4).toContain("past their review date");
    expect(beat4).toContain("WHOLE PERCENT");
    expect(beat4).toContain("owning department");
    // The honesty clause, which is the same code path rather than a courtesy: a
    // document nobody has been assigned has unknown coverage, not 0%.
    expect(beat4).toContain("not measurable");
    // And the instruction that makes the "why" appear on screen at all.
    expect(beat4).toContain("say which preference you applied");
  });

  it("addresses the desk rather than a named persona", () => {
    // These land in EVERY mapped persona's bucket (see memorySeedTargetUserIds), and
    // keel's role switcher sits in the header where a presenter will use it. A
    // preference phrased "when Sam asks…" would be recalled while Ana Reyes is on
    // screen and read as the memory system confusing two people.
    for (const memory of SEED_MEMORIES) {
      expect(memory.content).not.toMatch(
        /\b(Sam|Ana|Marcus|Ellis|Okafor|Reyes|Whitaker)\b/,
      );
    }
  });

  it("names beat 5's three writes, in order, and forbids a confirmation stop", () => {
    const beat5 = SEED_MEMORIES[1].content;
    const flag = beat5.indexOf("raiseReviewFlag");
    const notice = beat5.indexOf("sendOwnerNotice");
    const note = beat5.indexOf("addDocumentNote");
    expect(flag).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(flag);
    expect(note).toBeGreaterThan(notice);
    // A procedure that stops for confirmation can be abandoned mid-flight, and the
    // NEXT message then fails the whole thread with "Tool result is missing for
    // tool call ...". Written into the memory text, not only the prompt.
    expect(beat5).toContain("without asking for confirmation");
  });

  it("uses only vocabulary the beat-5 tools actually accept", () => {
    // A seeded procedure naming a reason or template the route refuses would fire
    // three writes, get a 422 on the first, and read on stage as the agent having
    // half-remembered the procedure.
    const beat5 = SEED_MEMORIES[1].content;
    const reason = REVIEW_FLAG_REASONS.find((r) => beat5.includes(`'${r}'`));
    const template = OWNER_NOTICE_TEMPLATES.find((t) =>
      beat5.includes(`'${t}'`),
    );
    expect(reason, "no valid review-flag reason is quoted").toBeDefined();
    expect(template, "no valid owner-notice template is quoted").toBeDefined();
  });

  it("tells beat 5 apart from beat 6, and forbids offering to record", () => {
    // The two procedures are the single easiest pair in this demo for the model to
    // confuse. Without this clause the agent conflates them and starts offering to
    // record a procedure it already has — the most confusing thing it can do on
    // this screen.
    const beat5 = SEED_MEMORIES[1].content;
    expect(beat5).toContain("NOT the procedure");
    expect(beat5).toContain("do not offer to record anything");
  });

  /**
   * THE ONE THAT MATTERS MOST. Beat 6's procedure is what the agent must be TAUGHT
   * on stage. Seed it and the agent already knows the answer, files the right code
   * first time, never offers to record, and the entire teach arc disappears — while
   * everything still compiles and still looks fine.
   */
  it("NEVER seeds beat 6's unlock procedure or any of its codes", () => {
    const all = SEED_MEMORIES.map((m) => m.content).join("\n");
    for (const code of VARIANCE_CODES) {
      expect(
        all,
        `${code} is seeded — beat 6 would open already taught`,
      ).not.toContain(code);
    }
    expect(all).not.toContain("fileReleaseVariance");
    expect(all.toLowerCase()).not.toContain("publication variance");
  });
});
