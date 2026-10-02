// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import * as ledger from "../data/store";
import { canonicalPairs } from "../data/recon-store";
import * as store from "./store";
import { deriveFallback, deriveWithLlm } from "./learn";
import { approveSkill, learn, LearningError } from "./service";
import { preview } from "./fine-tune";
import type { CustomEvent, TrajectoryDetail } from "./types";

const ev = (name: string, value: Record<string, unknown>): CustomEvent => ({
  type: "CUSTOM",
  name,
  timestamp: Date.now(),
  value,
});

const R = "/api/ledgerline/v1/reconciliation";
const WORKFLOW =
  "Receipt matching happens in a reconciliation session: open a session for the card and period, pair each charge with its receipts, validate the session, then close the period.";

/** The agent fails in-app, then Maya matches Priya's card on the board, with one wrong receipt first. */
function capture(): TrajectoryDetail {
  store.ingest([ev("thread.linked", { threadId: "thr_a", surface: "in_app" })]);
  store.recordMessage("thr_a", "in_app", {
    id: "m1",
    role: "user",
    text: "Match the 6 unmatched card transactions on Priya Raman's Visa ending 4417.",
    at: 1,
  });
  store.recordToolCall("thr_a", "in_app", {
    toolCallId: "tc1",
    name: "ledgerlineApi",
    args: { method: "PATCH", path: "/transactions/txn_4417_0912" },
    at: 10,
  });
  store.recordToolResult(
    "tc1",
    '{"error":"SESSION_REQUIRED","message":"Matches must be created inside a reconciliation session.","status":409}',
    11,
  );
  store.recordMessage("thr_a", "in_app", {
    id: "m2",
    role: "assistant",
    text: "I could not match them.",
    at: 12,
  });
  const pairs = canonicalPairs("card_4417");
  const wrongAmazon = pairs.map((p) =>
    p.transactionId === "txn_4417_0915"
      ? {
          ...p,
          receipts: [
            {
              id: "rcpt_amzn_0830",
              merchant: "Amazon.com",
              date: "2026-08-30",
              total: 89.97,
              currency: "USD",
            },
          ],
        }
      : p,
  );
  store.ingest([
    ev("screen.context", {
      label: "Card close: match each Priya Raman card charge to its receipts",
      fields: {
        view: "reconcile",
        cardId: "card_4417",
        period: "2026-09",
        text: WORKFLOW,
      },
    }),
    ev("screen.context", {
      label: "Receipt: Nopa Sep 12",
      fields: {
        view: "receipt",
        cardId: "card_4417",
        text: "tip $24.80 written by hand",
      },
    }),
    ev("network", {
      method: "POST",
      route: `${R}/sessions`,
      status: 201,
      request: { period: "2026-09", cardId: "card_4417" },
      response: { id: "rs_4417_09_001" },
    }),
    ...pairs.map((p) =>
      ev("network", {
        method: "POST",
        route: `${R}/sessions/[sessionId]/pairs`,
        status: 201,
        request: {
          transactionId: p.transactionId,
          receiptIds: p.receipts.map((r) => r.id),
          adjustment: p.adjustment,
        },
      }),
    ),
    ev("recon.validated", {
      cardId: "card_4417",
      period: "2026-09",
      valid: 5,
      total: 6,
      results: [
        {
          transactionId: "txn_4417_0915",
          valid: false,
          code: "WRONG_RECEIPT",
          descriptor: "AMZN MKTP US*2K4LM81Q2",
          reason:
            "Amazon.com, Aug 30 is 16 days before this charge posted (Sep 15), so it belongs to another statement.",
        },
      ],
      pairs: wrongAmazon,
    }),
    ev("recon.validated", {
      cardId: "card_4417",
      period: "2026-09",
      valid: 6,
      total: 6,
      results: [],
      pairs,
    }),
    ev("recon.period_closed", {
      cardId: "card_4417",
      period: "2026-09",
      matched: 6,
    }),
  ]);
  return store.learnableTrajectory()!;
}

describe("the deterministic learn fallback", () => {
  beforeEach(() => {
    ledger.reset();
    store.reset();
  });

  it("derives the recipe and the matching rules from the captured events, citing real eventIds", () => {
    const d = capture();
    expect(d.trajectory.outcome).toBe("agent_failed_user_completed");
    expect(d.trajectory.title).toBe(
      "Match Priya Raman's September card transactions",
    );
    const out = deriveFallback(d, 1);
    const real = new Set(d.events.map((e) => e.eventId));
    const [insight] = out.insights;
    expect(insight!.title).toMatch(/reconciliation session/);
    expect(insight!.evidence[0]!.eventIds.length).toBeGreaterThanOrEqual(6);
    expect(insight!.evidence[0]!.eventIds.every((id) => real.has(id))).toBe(
      true,
    );
    expect(insight!.evidence[0]!.quote).toBe(WORKFLOW);
    expect(insight!.summary).toMatch(/after 1 match failed validation/);

    const md = out.skills[0]!.skillMd;
    expect(out.skills[0]).toMatchObject({
      name: "match-card-receipts",
      status: "candidate",
      revision: 1,
    });
    // The recipe, in order, through the generic tool.
    const order = [
      "POST /reconciliation/sessions",
      "/pairs",
      "/validate",
      "reviewMatches",
    ].map((s) => md.indexOf(s));
    expect(
      order.every((i, n) => i > -1 && (n === 0 || i > order[n - 1]!)),
    ).toBe(true);
    // The rules the person's matches taught.
    expect(md).toContain('"kind": "gratuity"');
    expect(md).toMatch(
      /Nopa: receipt \$124\.00, charge \$148\.80, gratuity 24\.80/,
    );
    expect(md).toContain('"kind": "fx_conversion"');
    expect(md).toMatch(/rate 1\.1086/);
    expect(md).toMatch(
      /United Airlines \$598\.20 \+ United Airlines \$88\.00 = \$686\.20/,
    );
    expect(md).toMatch(/16 days before this charge/);
    expect(md).toContain('"SQ *BLUEBOTTLE COFFEE SF" = Blue Bottle Coffee');
    // The hand-over: never close.
    expect(md).toMatch(
      /Never call POST \/reconciliation\/sessions\/\{id\}\/close/,
    );
    expect(md).toContain(d.trajectory.trajectoryId);

    expect(out.evalCandidates).toHaveLength(3);
    expect(out.evalCandidates[0]!.checks).toContain(
      "Creates a reconciliation session before pairing",
    );
    expect(out.evalCandidates[2]!.query).toMatch(/expense reports/);
    for (const c of out.evalCandidates) {
      expect(c.status).toBe("pending");
      expect(c.sourceEventIds.every((id) => real.has(id))).toBe(true);
    }
    expect(JSON.stringify(out)).not.toMatch(/—/);
  });

  it("is what the LLM path returns when there is no API key", async () => {
    const d = capture();
    const out = await deriveWithLlm(d, 1, { apiKey: "" });
    expect(out.derivedBy).toBe("fallback");
    expect(out.fallbackReason).toMatch(/OPENAI_API_KEY/);
  });

  it("refuses to learn before anything was captured, and from a trajectory with no completed close", async () => {
    await expect(learn({ llm: false })).rejects.toBeInstanceOf(LearningError);
    store.ingest([ev("click", { action: "Open month-end close" })]);
    await expect(learn({ llm: false })).rejects.toMatchObject({
      code: "NO_FIX_CAPTURED",
    });
  });

  it("publishes on approve, and builds a fine-tune preview of the recipe", async () => {
    capture();
    await learn({ llm: false });
    const skill = await approveSkill("match-card-receipts");
    expect(skill.status).toBe("published");
    expect(store.publishedSkills()).toHaveLength(1);
    const p = preview("thinking-machines", store.learnableTrajectory());
    expect(p).toMatchObject({
      target: "thinking-machines",
      format: "jsonl",
      examples: 3,
    });
    const sample = JSON.stringify(p.sample[0]);
    expect(sample).toContain("/reconciliation/sessions");
    expect(sample).toContain("gratuity");
    expect(sample).toContain("reviewMatches");
    expect(sample).not.toContain("/close");
  });

  it("can publish the skill even when approve arrives before any capture", async () => {
    const skill = await approveSkill("match-card-receipts");
    expect(skill.status).toBe("published");
    expect(skill.skillMd).toContain("fx_conversion");
  });
});
