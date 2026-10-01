// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import * as ledger from "../data/store";
import * as store from "./store";
import type { CustomEvent } from "./types";

const ev = (
  name: string,
  value: Record<string, unknown>,
  t = Date.now(),
): CustomEvent => ({
  type: "CUSTOM",
  name,
  timestamp: t,
  value,
});

const today = () =>
  store
    .listTrajectories()
    .filter((t) => !t.trajectoryId.startsWith("trj_hist"));

describe("the trajectory store", () => {
  beforeEach(() => {
    ledger.reset();
    store.reset();
  });

  it("starts from seed history only", () => {
    expect(today()).toHaveLength(0);
    expect(store.listTrajectories().length).toBe(2);
  });

  it("holds page views as lead-in until something meaningful happens", () => {
    store.ingest([ev("page", { route: "/reports" })]);
    expect(today()).toHaveLength(0);
    store.ingest([ev("click", { action: "Open report", route: "/reports" })]);
    const [t] = today();
    expect(t?.eventCount).toBe(2);
    const d = store.trajectoryDetail(t!.trajectoryId)!;
    expect(d.events.map((e) => e.event.name)).toEqual(["page", "click"]);
    expect(d.events.every((e) => e.eventId.startsWith("evt_"))).toBe(true);
  });

  it("links an in-app Thread strongly and a ChatGPT one weakly, and records the trace", () => {
    store.ingest([
      ev("thread.linked", { threadId: "thr_a", surface: "in_app" }),
    ]);
    store.recordMessage("thr_a", "in_app", {
      id: "m1",
      role: "user",
      text: "Approve Priya's report",
      at: 1,
    });
    store.recordToolCall("thr_a", "in_app", {
      toolCallId: "tc1",
      name: "approveReport",
      args: { reportId: "EXP-2291" },
      at: 1000,
    });
    store.recordToolResult(
      "tc1",
      JSON.stringify({ error: "POLICY_HOLD", code: "POL-114" }),
      1412,
    );
    store.recordMessage("thr_a", "in_app", {
      id: "m2",
      role: "assistant",
      text: "I could not approve it.",
      at: 2000,
    });

    const gpt = store.chatgptThreadId("openai-mcp/1.0.0", 3000);
    expect(store.chatgptThreadId("openai-mcp/1.0.0", 4000)).toBe(gpt);
    store.recordToolCall(gpt, "chatgpt", {
      toolCallId: "tc2",
      name: "approveReport",
      args: { reportId: "EXP-2291" },
      at: 3000,
    });
    store.recordToolResult(
      "tc2",
      JSON.stringify({ error: "POLICY_HOLD", code: "POL-114" }),
      3005,
    );

    const [t] = today();
    const d = store.trajectoryDetail(t!.trajectoryId)!;
    const inApp = d.threads.find((x) => x.surface === "in_app")!;
    const chat = d.threads.find((x) => x.surface === "chatgpt")!;
    expect(inApp.linkStrength).toBe("strong");
    expect(chat.linkStrength).toBe("weak");
    expect(inApp.agentTrace[0]).toMatchObject({
      name: "approveReport",
      status: "error",
      durationMs: 412,
      result: { code: "POL-114" },
    });
    expect(inApp.outcome).toBe("failed");
    expect(chat.outcome).toBe("failed");
    expect(t?.surfaces).toEqual(["in_app", "chatgpt"]);
  });

  it("closes on the user's manual completion, flags the unseen Policy panel, and starts fresh after", () => {
    store.ingest([
      ev("thread.linked", { threadId: "thr_a", surface: "in_app" }),
    ]);
    store.recordToolCall("thr_a", "in_app", {
      toolCallId: "tc1",
      name: "approveReport",
      args: { reportId: "EXP-2291" },
      at: 1,
    });
    store.recordToolResult(
      "tc1",
      '{"error":"POLICY_HOLD","code":"POL-114"}',
      2,
    );
    store.recordMessage("thr_a", "in_app", {
      id: "m2",
      role: "assistant",
      text: "Blocked.",
      at: 3,
    });
    store.ingest([
      ev("screen.context", {
        label:
          "Policy panel: Team events over $2,500 must be allocated to an events cost center before approval",
        fields: {
          reportId: "EXP-2291",
          holdCode: "POL-114",
          text: "Team events over $2,500 must be allocated to an events cost center before approval",
        },
      }),
      ev("expense.cost_center_allocated", {
        reportId: "EXP-2291",
        costCenter: "CC-410",
      }),
      ev("expense.report_approved", { reportId: "EXP-2291", by: "user" }),
      ev("expense.reimbursed", { reportId: "EXP-2291", by: "user" }),
    ]);
    const [t] = today();
    expect(t?.outcome).toBe("agent_failed_user_completed");
    expect(t?.title).toBe("Approve Priya Raman's Q3 offsite report");
    const d = store.trajectoryDetail(t!.trajectoryId)!;
    expect(d.missingContext).toHaveLength(1);
    expect(d.missingContext[0]!.eventId).toBe(
      d.events.find((e) => e.event.name === "screen.context")!.eventId,
    );

    store.ingest([ev("click", { action: "Back to expense reports" })]);
    expect(today()).toHaveLength(2);
  });

  it("drops what is not an AG-UI CUSTOM event", () => {
    expect(
      store.isCustomEvent({
        type: "CUSTOM",
        name: "click",
        timestamp: 1,
        value: {},
      }),
    ).toBe(true);
    expect(
      store.isCustomEvent({
        type: "TEXT_MESSAGE_START",
        name: "x",
        timestamp: 1,
        value: {},
      }),
    ).toBe(false);
    expect(
      store.isCustomEvent({
        type: "CUSTOM",
        name: "",
        timestamp: 1,
        value: {},
      }),
    ).toBe(false);
  });
});
