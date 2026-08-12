import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/keel/data/store";
import { getPersona } from "@/skins/keel/data/personas";
import { VARIANCE_CODES, isJustifying } from "@/skins/keel/data/variance-codes";
import { gatedRevisions } from "@/skins/keel/data/release-authority";

beforeEach(() => store.reset());
// `vi.stubEnv` leaks into later test FILES, not just later tests, so the
// unstub is mandatory rather than tidy.
afterEach(() => vi.unstubAllEnvs());

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

describe("what the reset does NOT claim", () => {
  it("reports store only — NEVER memory, which keel cannot yet reset", async () => {
    // Keel has no seed-memories / forget-memories pair, so this route cannot
    // wipe a learned procedure or re-arm beats 4 and 5. Listing "memory" here
    // would be the single most misleading string this route could return: a
    // presenter reading it stops looking for the reason beat 6 opened already
    // taught. When the memory slot lands, this assertion is the one to change.
    const body = await (await POST()).json();
    expect(body).toEqual({ ok: true, reset: ["store"] });
    expect(JSON.stringify(body)).not.toContain("memory");
  });
});
