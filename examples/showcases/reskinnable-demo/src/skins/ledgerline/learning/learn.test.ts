// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import * as ledger from "../data/store";
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

const PANEL =
  "Team events over $2,500 must be allocated to an events cost center before approval";

function capture(): TrajectoryDetail {
  store.ingest([ev("thread.linked", { threadId: "thr_a", surface: "in_app" })]);
  store.recordMessage("thr_a", "in_app", {
    id: "m1",
    role: "user",
    text: "Approve Priya Raman's Q3 team offsite expense report and reimburse her.",
    at: 1,
  });
  for (const [id, at] of [
    ["tc1", 10],
    ["tc2", 20],
  ] as const) {
    store.recordToolCall("thr_a", "in_app", {
      toolCallId: id,
      name: "approveReport",
      args: { reportId: "EXP-2291" },
      at,
    });
    store.recordToolResult(
      id,
      '{"error":"POLICY_HOLD","code":"POL-114"}',
      at + 5,
    );
  }
  store.recordMessage("thr_a", "in_app", {
    id: "m2",
    role: "assistant",
    text: "I could not approve it.",
    at: 30,
  });
  store.ingest([
    ev("screen.context", {
      label: `Policy panel: ${PANEL}`,
      fields: {
        reportId: "EXP-2291",
        employee: "Priya Raman",
        holdCode: "POL-114",
        text: PANEL,
        category: "Team event",
        total: 4860,
        threshold: 2500,
      },
    }),
    ev("click", {
      action: "Allocate cost center",
      role: "button",
      tag: "button",
      route: "/reports/[id]",
    }),
    ev("click", {
      action: "Cost center: CC-410 Events & Offsites",
      role: "option",
      tag: "button",
      route: "/reports/[id]",
    }),
    ev("expense.cost_center_allocated", {
      reportId: "EXP-2291",
      employee: "Priya Raman",
      costCenter: "CC-410",
      costCenterName: "Events & Offsites",
    }),
    ev("expense.report_approved", { reportId: "EXP-2291", by: "user" }),
    ev("expense.reimbursed", { reportId: "EXP-2291", by: "user" }),
  ]);
  return store.learnableTrajectory()!;
}

describe("the deterministic learn fallback", () => {
  beforeEach(() => {
    ledger.reset();
    store.reset();
  });

  it("derives the insight, skill and eval candidates from the captured events, citing real eventIds", () => {
    const d = capture();
    const out = deriveFallback(d, 1);
    const real = new Set(d.events.map((e) => e.eventId));
    const [insight] = out.insights;
    expect(insight!.title).toBe(
      "Team-event reports over $2,500 need an events cost center before approval",
    );
    expect(insight!.evidence[0]!.eventIds.length).toBeGreaterThanOrEqual(4);
    expect(insight!.evidence[0]!.eventIds.every((id) => real.has(id))).toBe(
      true,
    );
    expect(insight!.evidence[0]!.quote).toContain(PANEL);
    expect(insight!.threadCount).toBe(1);

    const [skill] = out.skills;
    expect(skill).toMatchObject({
      name: "approve-team-event-expense",
      status: "candidate",
      revision: 1,
    });
    expect(skill!.skillMd).toMatch(/allocateCostCenter[^\n]*CC-410/);
    expect(skill!.skillMd).toContain("approveReport");
    expect(skill!.skillMd).toContain(d.trajectory.trajectoryId);

    expect(out.evalCandidates).toHaveLength(3);
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

  it("refuses to learn before anything was captured, and from a trajectory with no fix", async () => {
    await expect(learn({ llm: false })).rejects.toBeInstanceOf(LearningError);
    store.ingest([ev("click", { action: "Open report" })]);
    await expect(learn({ llm: false })).rejects.toMatchObject({
      code: "NO_FIX_CAPTURED",
    });
  });

  it("publishes on approve, and builds a fine-tune preview from the same trajectory", async () => {
    capture();
    await learn({ llm: false });
    const skill = await approveSkill("approve-team-event-expense");
    expect(skill.status).toBe("published");
    expect(store.publishedSkills()).toHaveLength(1);
    const p = preview("thinking-machines", store.learnableTrajectory());
    expect(p).toMatchObject({
      target: "thinking-machines",
      format: "jsonl",
      examples: 3,
    });
    expect(JSON.stringify(p.sample[0])).toContain("allocateCostCenter");
  });

  it("can publish the skill even when approve arrives before any capture", async () => {
    const skill = await approveSkill("approve-team-event-expense");
    expect(skill.status).toBe("published");
    expect(skill.skillMd).toContain("CC-410");
  });
});
