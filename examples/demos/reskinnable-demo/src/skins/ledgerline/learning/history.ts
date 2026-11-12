import type { LearningState } from "./store";
import type { CustomEvent } from "./types";

/**
 * Two earlier trajectories from previous days, so the Trajectories list has
 * history behind today's capture. Both are ordinary agent successes; they are
 * seed data (marked `seeded`), never touched by capture, and /learn ignores
 * them. Reset restores them as they are.
 */
export function buildHistory(s: LearningState, now: number): void {
  const day = 86_400_000;
  const make = (
    trajectoryId: string,
    threadId: string,
    start: number,
    request: string,
    answer: string,
    calls: {
      name: string;
      args: Record<string, unknown>;
      result: unknown;
      ms: number;
    }[],
    events: Omit<CustomEvent, "type" | "timestamp">[],
  ) => {
    s.trajectories.push({
      trajectoryId,
      createdAt: start,
      closedAt: start + 90_000,
      closedBy: "agent",
      seeded: true,
    });
    events.forEach((e, i) => {
      s.events.push({
        eventId: `${trajectoryId.replace("trj", "evt")}_${i + 1}`,
        trajectoryId,
        position: ++s.position,
        persistedAt: start + i * 4000 + 300,
        event: { type: "CUSTOM", timestamp: start + i * 4000, ...e },
      });
    });
    let at = start + 2000;
    s.threads.push({
      threadId,
      trajectoryId,
      surface: "in_app",
      linkStrength: "strong",
      outcome: "succeeded",
      messages: [
        { id: `${threadId}_m1`, role: "user", text: request, at: start + 1000 },
        {
          id: `${threadId}_m2`,
          role: "assistant",
          text: answer,
          at: start + 60_000,
        },
      ],
      agentTrace: calls.map((c, i) => {
        at += c.ms + 900;
        return {
          id: `${threadId}_tc${i + 1}`,
          kind: "tool.call" as const,
          name: c.name,
          args: c.args,
          result: c.result,
          status: "ok" as const,
          durationMs: c.ms,
          at,
        };
      }),
    });
  };

  make(
    "trj_hist0927a",
    "thr_hist0927a",
    now - 4 * day,
    "Approve Daniel Okafor's prospect breakfast and reimburse him.",
    "Approved **EXP-2252**, Daniel Okafor's prospect breakfast (**$96.40**), and scheduled the ACH reimbursement.",
    [
      {
        name: "listReports",
        args: { employee: "Daniel Okafor", status: "submitted" },
        result: { count: 1, reports: [{ id: "EXP-2252" }] },
        ms: 180,
      },
      {
        name: "approveReport",
        args: { reportId: "EXP-2252" },
        result: { id: "EXP-2252", status: "approved" },
        ms: 240,
      },
      {
        name: "reimburseReport",
        args: { reportId: "EXP-2252" },
        result: { id: "EXP-2252", status: "reimbursed" },
        ms: 260,
      },
    ],
    [
      { name: "page", value: { route: "/reports", title: "Expense reports" } },
      {
        name: "thread.linked",
        value: { threadId: "thr_hist0927a", surface: "in_app" },
      },
      { name: "navigation", value: { from: "/reports", to: "/reports/[id]" } },
      {
        name: "expense.report_approved",
        value: { reportId: "EXP-2252", by: "agent" },
      },
    ],
  );

  make(
    "trj_hist0929b",
    "thr_hist0929b",
    now - 2 * day,
    "Approve Elena Petrova's data summit pass.",
    "Approved **EXP-2281**, Elena Petrova's data summit pass (**$795.00**).",
    [
      {
        name: "listReports",
        args: { employee: "Elena Petrova" },
        result: { count: 1, reports: [{ id: "EXP-2281" }] },
        ms: 170,
      },
      {
        name: "approveReport",
        args: { reportId: "EXP-2281" },
        result: { id: "EXP-2281", status: "approved" },
        ms: 230,
      },
    ],
    [
      { name: "page", value: { route: "/reports", title: "Expense reports" } },
      {
        name: "thread.linked",
        value: { threadId: "thr_hist0929b", surface: "in_app" },
      },
      {
        name: "expense.report_approved",
        value: { reportId: "EXP-2281", by: "agent" },
      },
    ],
  );
}
