import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/keel/data/store";
import { getPersona } from "@/skins/keel/data/personas";
import { VARIANCE_CODES, isJustifying } from "@/skins/keel/data/variance-codes";
import { gatedRevisions } from "@/skins/keel/data/release-authority";
import { SEED_MEMORIES } from "@/skins/keel/intelligence/seed-memories";
import {
  memoryScopeUserIds,
  memorySeedTargetUserIds,
} from "@/skins/keel/intelligence/user-id";

beforeEach(() => {
  store.reset();
  // The store-only cases below must not reach a memory backend. Every
  // Intelligence-path test arms these itself.
  vi.stubEnv("INTELLIGENCE_API_URL", "");
  vi.stubEnv("CPK_INTELLIGENCE_API_KEY", "");
});
// `vi.stubEnv` leaks into later test FILES, not just later tests, so the
// unstub is mandatory rather than tidy.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SAM = getPersona("sam-okafor");

describe("the presenter gate", () => {
  it("403s in production without PRESENTER_RESET_ENABLED", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PRESENTER_RESET_ENABLED", "");
    const res = await POST();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("FORBIDDEN");
  });

  it("allows a production booth that opted in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PRESENTER_RESET_ENABLED", "true");
    expect((await POST()).status).toBe(200);
  });

  it("allows any non-production environment", async () => {
    expect((await POST()).status).toBe(200);
  });
});

describe("what the reset restores", () => {
  it("re-arms beat 6 — both gated cases are unreleased and unlocked again", async () => {
    // A surviving ratified variance is the most demo-destroying form this bug
    // takes: everything still works and beat 6 just proves nothing.
    const [first] = gatedRevisions(store.documents(), store.variances());
    const code = VARIANCE_CODES.find(isJustifying)!;
    const variance = store.fileVariance(first.record.docId, code, "x", SAM);
    store.ratifyVariance(variance.id);
    store.releaseRevision(
      first.record.docId,
      SAM.name,
      "variance",
      variance.id,
    );

    await POST();

    expect(store.variances()).toEqual([]);
    expect(gatedRevisions(store.documents(), store.variances())).toHaveLength(
      2,
    );
    expect(store.findDocument(first.record.docId)?.releases).toBeUndefined();
  });

  it("drops beat 5's three writes off every record", async () => {
    store.raiseReviewFlag("breach-response", "review-overdue", SAM.name);
    store.sendOwnerNotice("breach-response", "review-due", SAM.name);
    store.addDocumentNote("breach-response", "chased", SAM.name);
    await POST();
    const record = store.findDocument("breach-response");
    expect(record?.reviewFlag).toBeUndefined();
    expect(record?.ownerNotices).toBeUndefined();
    expect(record?.notes).toBeUndefined();
  });

  it("empties beat 3d's artifacts", async () => {
    store.fileImpactBrief({
      source: "State Department of Health",
      space: "privacy",
      effective: "x",
      summary: "s",
      citations: [],
      impacts: [],
      filedBy: SAM.name,
      role: SAM.role,
    });
    await POST();
    expect(store.impactBriefs()).toEqual([]);
  });

  it("restores the four runs", async () => {
    store.cancelRun("RUN-1044");
    store.startRun("phi-access-contractor", { subject: "x" }, SAM.name);
    await POST();
    expect(store.runs()).toHaveLength(4);
    expect(store.findRun("RUN-1044")?.status).toBe("blocked");
  });

  it("re-anchors the review dates, so beat 3c's lever still discriminates", async () => {
    // Some overdue, some not. A register rebuilt from a fixed calendar anchor
    // would drift until EVERY row was overdue, and the `review_overdue` lever
    // would look broken on stage while being perfectly correct.
    await POST();
    const past = store
      .documents()
      .filter((d) => Date.parse(`${d.reviewDue}T00:00:00Z`) < Date.now());
    expect(past.length).toBeGreaterThan(0);
    expect(past.length).toBeLessThan(store.documents().length);
  });
});

describe("the OSS path, where there is no durable memory", () => {
  it("reports store only, and NEVER claims memory it did not touch", async () => {
    // Unset Intelligence env ⇒ nothing to wipe and nothing to re-seed, so beats
    // 2/4/5/6 degrade by design. Listing "memory" here would be the single most
    // misleading string this route could return: a presenter reading it stops
    // looking for the reason beat 6 opened already taught.
    vi.stubEnv("INTELLIGENCE_API_URL", "");
    vi.stubEnv("CPK_INTELLIGENCE_API_KEY", "");
    const body = await (await POST()).json();
    expect(body).toEqual({ ok: true, reset: ["store"] });
    expect(JSON.stringify(body)).not.toContain("memory");
  });
});

/**
 * THE MEMORY HALF. This is the part with no runtime symptom at all: a reset that
 * silently misses a bucket, or seeds nothing, returns a plausible body and the demo
 * simply proves nothing on stage.
 *
 * `fetch` is stubbed rather than an Intelligence stack run, so what is asserted is
 * the route's own contract — which buckets it sweeps, whether it VERIFIES the seed
 * count, and what it claims in each outcome.
 */
describe("the Intelligence path — wipe, re-seed, and what it claims", () => {
  const armEnv = () => {
    vi.stubEnv("INTELLIGENCE_API_URL", "http://intel.internal:7450");
    vi.stubEnv("CPK_INTELLIGENCE_API_KEY", "sk-test-key");
    // Unpinned, so the bucket set is the derived one rather than collapsing onto a
    // single pinned id (playwright pins one; see intelligence/user-id.ts).
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
  };

  /** Empty list on every GET, 201 on every seed POST — the happy path. */
  const stubHappyFetch = () => {
    const calls: { url: string; method: string; userId?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({
          url,
          method: init?.method ?? "GET",
          userId: headers["X-Cpki-User-Id"] ?? headers["x-cpki-user-id"],
        });
        if ((init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify({ memories: [] }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({}), { status: 201 });
      }),
    );
    return calls;
  };

  it("claims store AND memory only when every expected seed landed", async () => {
    armEnv();
    stubHappyFetch();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reset).toEqual(["store", "memory"]);
    expect(body.memory).toBe("seeded");
    // COMPARED, not reported. `seedMemories` never throws — it counts stored rows
    // and logs the rest — so without this the route once answered
    // `reset: ["store","memory"]` against a backend that had rejected every POST.
    expect(body.seeded).toBe(
      memorySeedTargetUserIds().length * SEED_MEMORIES.length,
    );
    expect(body.expectedSeeds).toBe(body.seeded);
  });

  it("sweeps EVERY bucket the runtime can reach, asked for rather than hardcoded", async () => {
    armEnv();
    const calls = stubHappyFetch();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await POST();

    // A hardcoded list in the route is what shipped in Bellwether and could not
    // possibly be right — miss a bucket and beat 6 starts out already taught.
    const swept = new Set(
      calls.filter((c) => c.method === "GET").map((c) => c.userId),
    );
    for (const id of memoryScopeUserIds()) {
      expect(swept.has(id), `${id} was never swept`).toBe(true);
    }
  });

  it("seeds every target bucket, including the DEFAULT one runs actually resolve to", async () => {
    armEnv();
    const calls = stubHappyFetch();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await POST();

    const seededBuckets = new Set(
      calls.filter((c) => c.method === "POST").map((c) => c.userId),
    );
    for (const id of memorySeedTargetUserIds()) {
      expect(seededBuckets.has(id), `${id} was never seeded`).toBe(true);
    }
  });

  it("502s and refuses to claim memory when NOTHING was seeded", async () => {
    armEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        (init?.method ?? "GET") === "GET"
          ? new Response(JSON.stringify({ memories: [] }), { status: 200 })
          : new Response("nope", { status: 500 }),
      ),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST();
    const body = await res.json();

    // A 200 here would navigate the presenter to a clean-looking app whose memory
    // beats are quietly broken — the precise failure this route exists to prevent.
    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.reset).toEqual(["store"]);
    expect(body.memory).toBe("failed");
    expect(body.memoryError).toContain("beats 4/5 are not armed");
  });

  it("502s on a PARTIAL seed just as loudly, because a shortfall names no memory", async () => {
    armEnv();
    let posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify({ memories: [] }), {
            status: 200,
          });
        }
        posts += 1;
        return posts === 1
          ? new Response(JSON.stringify({}), { status: 201 })
          : new Response("nope", { status: 500 });
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.memory).toBe("partial");
    expect(body.reset).toEqual(["store"]);
  });

  it("reports MEASURED progress when a bucket cannot be enumerated", async () => {
    // `forgetAllMemories` THROWS rather than guess at a list it never got. The old
    // shape inferred memory state from `forgot` alone, which claimed
    // `reset: ["store","memory"]` even though the seed loop may never have run.
    armEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.reset).toEqual(["store"]);
    expect(body.memory).toBe("failed");
    expect(body.bucketsSwept).toBe(0);
    expect(body.bucketsToSweep).toBe(memoryScopeUserIds().length);
    expect(body.memoryError).toContain("interrupted during the wipe phase");
  });

  it("never puts the Intelligence address or key in a response body", async () => {
    // This route's gate is a demo convenience, not an authorization boundary: a
    // booth that set PRESENTER_RESET_ENABLED answers this POST for anyone who can
    // reach the box. The address belongs in the LOG, which is why the failure is
    // logged unredacted and the body is not.
    armEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(
          "Failed to parse URL from http://intel.internal:7450/api/memories (key sk-test-key)",
        );
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const text = JSON.stringify(await (await POST()).json());
    expect(text).not.toContain("intel.internal");
    expect(text).not.toContain("sk-test-key");
  });
});
