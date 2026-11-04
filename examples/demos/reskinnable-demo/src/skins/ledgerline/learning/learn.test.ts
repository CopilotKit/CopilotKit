// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import * as ledger from "../data/store";
import { canonicalExceptions, canonicalPairs } from "../data/recon-store";
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

const API = "/api/ledgerline/v1";
const WORKFLOW =
  "The close runs in a reconciliation session. Receipts auto-match when it opens. Each exception is cleared in its own workflow.";

/** What the board records for each exception, as the person cleared it. */
function resolved() {
  return canonicalExceptions("card_4417").map((x) => ({
    transactionId: x.transactionId,
    descriptor: x.descriptor,
    amount: x.amount,
    kind: x.exception.kind,
    exception: x.exception,
    resolution:
      x.expected.kind === "split"
        ? { kind: "split", lines: x.expected.lines }
        : x.expected.kind === "reclass"
          ? {
              kind: "reclass",
              fromAccount: x.expected.fromAccount,
              toAccount: x.expected.toAccount,
              memo: "Figma is design software.",
            }
          : x.expected.kind === "personal"
            ? { kind: "personal", method: "payroll_deduction" }
            : {
                kind: "missing_receipt",
                memo: "Ride from the Chicago client office to O'Hare after the onsite.",
                attestedBy: "Priya Raman",
              },
  }));
}

/** The agent fails in-app, then Maya clears Priya's exceptions on the board, with one wrong reclass first. */
function capture(): TrajectoryDetail {
  store.ingest([ev("thread.linked", { threadId: "thr_a", surface: "in_app" })]);
  store.recordMessage("thr_a", "in_app", {
    id: "m1",
    role: "user",
    text: "Close out September for Priya Raman's Visa ending 4417.",
    at: 1,
  });
  store.recordToolCall("thr_a", "in_app", {
    toolCallId: "tc1",
    name: "ledgerlineApi",
    args: { method: "PATCH", path: "/transactions/txn_4417_0910" },
    at: 10,
  });
  store.recordToolResult(
    "tc1",
    '{"error":"PERIOD_SOFT_LOCKED","message":"September coding is locked for the preliminary close.","status":423}',
    11,
  );
  store.recordMessage("thr_a", "in_app", {
    id: "m2",
    role: "assistant",
    text: "I could not clear them.",
    at: 12,
  });
  const exceptions = resolved();
  const pairs = canonicalPairs("card_4417").map((p) => ({
    transactionId: p.transactionId,
    descriptor: p.descriptor,
    amount: p.amount,
    auto: true,
  }));
  store.ingest([
    ev("screen.context", {
      label: "Card close: clear Priya Raman's exceptions",
      fields: {
        view: "reconcile",
        cardId: "card_4417",
        period: "2026-09",
        text: WORKFLOW,
      },
    }),
    ev("screen.context", {
      label: "Split: TERRAIN EVENTS 0919",
      fields: {
        view: "close.split",
        transactionId: "txn_4417_0919",
        text: "Product offsite: Engineering 6, Design 3, Product 3.",
      },
    }),
    ev("network", {
      method: "POST",
      route: `${API}/reconciliation/sessions`,
      status: 201,
      request: { period: "2026-09", cardId: "card_4417" },
      response: { id: "rs_4417_09_001" },
    }),
    ev("network", {
      method: "POST",
      route: `${API}/allocations`,
      status: 201,
      request: { transactionId: "txn_4417_0919" },
    }),
    ev("network", {
      method: "PUT",
      route: `${API}/allocations/[allocationId]/lines`,
      status: 200,
    }),
    ev("network", {
      method: "POST",
      route: `${API}/allocations/[allocationId]/commit`,
      status: 200,
    }),
    ev("network", {
      method: "POST",
      route: `${API}/journal/reclasses`,
      status: 201,
    }),
    ev("network", { method: "POST", route: `${API}/repayments`, status: 201 }),
    ev("network", { method: "POST", route: `${API}/affidavits`, status: 201 }),
    ev("recon.validated", {
      cardId: "card_4417",
      period: "2026-09",
      valid: 9,
      total: 10,
      results: [
        {
          transactionId: "txn_4417_0910",
          valid: false,
          code: "WRONG_ACCOUNT",
          descriptor: "FIGMA* MONTHLY 415-890-5404",
        },
      ],
      pairs,
      exceptions,
    }),
    ev("recon.validated", {
      cardId: "card_4417",
      period: "2026-09",
      valid: 10,
      total: 10,
      results: [],
      pairs,
      exceptions,
    }),
    ev("recon.period_closed", {
      cardId: "card_4417",
      period: "2026-09",
      matched: 6,
      exceptions: 4,
    }),
  ]);
  return store.learnableTrajectory()!;
}

describe("the deterministic learn fallback", () => {
  beforeEach(() => {
    ledger.reset();
    store.reset();
  });

  it("derives the recipe and the rules from the captured events, citing real eventIds", () => {
    const d = capture();
    expect(d.trajectory.outcome).toBe("agent_failed_user_completed");
    expect(d.trajectory.title).toBe("Close out Priya Raman's September card");
    const out = deriveFallback(d, 1);
    const real = new Set(d.events.map((e) => e.eventId));
    const [insight] = out.insights;
    expect(insight!.title).toMatch(/own workflows/);
    expect(insight!.evidence[0]!.eventIds.length).toBeGreaterThanOrEqual(8);
    expect(insight!.evidence[0]!.eventIds.every((id) => real.has(id))).toBe(
      true,
    );
    expect(insight!.evidence[0]!.quote).toBe(WORKFLOW);
    expect(insight!.summary).toMatch(/after 1 failed validation/);

    const md = out.skills[0]!.skillMd;
    expect(out.skills[0]).toMatchObject({
      name: "close-card-exceptions",
      status: "candidate",
      revision: 1,
    });
    // The recipe, in order, through the generic tool.
    const order = [
      "POST /reconciliation/sessions",
      "POST /allocations",
      "/commit",
      "POST /journal/reclasses",
      "POST /repayments",
      "POST /affidavits",
      "/validate",
      "reviewMatches",
    ].map((s) => md.indexOf(s));
    expect(
      order.every((i, n) => i > -1 && (n === 0 || i > order[n - 1]!)),
    ).toBe(true);
    // The rules the person's choices taught.
    expect(md).toMatch(
      /Engineering \$1,200\.00, Design \$600\.00, Product \$600\.00/,
    );
    expect(md).toMatch(/FIGMA\* MONTHLY 415-890-5404: 6100 to 6420/);
    expect(md).toContain('"payroll_deduction"');
    expect(md).toMatch(/Chicago client office/);
    // The hand-over: never close.
    expect(md).toMatch(
      /Never call POST \/reconciliation\/sessions\/\{id\}\/close/,
    );
    expect(md).toContain(d.trajectory.trajectoryId);

    expect(out.evalCandidates).toHaveLength(3);
    expect(out.evalCandidates[0]!.checks).toContain(
      "Creates a reconciliation session before clearing exceptions",
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
    const skill = await approveSkill("close-card-exceptions");
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
    expect(sample).toContain("/allocations");
    expect(sample).toContain("payroll_deduction");
    expect(sample).toContain("reviewMatches");
    expect(sample).not.toContain("/close");
  });

  it("can publish the skill even when approve arrives before any capture", async () => {
    const skill = await approveSkill("close-card-exceptions");
    expect(skill.status).toBe("published");
    expect(skill.skillMd).toContain("POST /journal/reclasses");
  });
});
