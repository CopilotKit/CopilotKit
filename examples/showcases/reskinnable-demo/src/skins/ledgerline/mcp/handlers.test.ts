// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import * as ledger from "../data/store";
import * as recon from "../data/recon-store";
import * as learning from "../learning/store";
import { approveSkill } from "../learning/service";
import { runTool } from "./handlers";

const ua = "openai-mcp/1.0.0";
const api = (method: string, path: string, body?: unknown) =>
  runTool("ledgerlineApi", { method, path, ...(body ? { body } : {}) }, ua);

describe("the Ledgerline MCP tools", () => {
  beforeEach(() => {
    ledger.reset();
    learning.reset();
  });

  it("fail the month-end close without the skill, then do it with the skill and hand it over", async () => {
    // Without the skill: editing an exception is refused, nothing to review, no close.
    expect(
      api("PATCH", "/transactions/txn_4417_0910", { status: "cleared" }),
    ).toMatchObject({ error: "PERIOD_SOFT_LOCKED", status: 423 });
    expect(
      api("PATCH", "/transactions/txn_4417_0919", { department: "dept_eng" }),
    ).toMatchObject({ error: "ALLOCATION_REQUIRED", status: 409 });
    const s = api("POST", "/reconciliation/sessions", {
      period: "2026-09",
      cardId: "card_4417",
    }) as { body: { id: string } };
    const v = api("POST", `/reconciliation/sessions/${s.body.id}/validate`) as {
      body: { valid: number; total: number };
    };
    expect(v.body).toMatchObject({ valid: 6, total: 10 });
    expect(
      runTool("reviewMatches", { sessionId: s.body.id }, ua),
    ).toMatchObject({ error: "VALIDATION_FAILED" });
    expect(
      api("POST", `/reconciliation/sessions/${s.body.id}/close`),
    ).toMatchObject({ error: "HUMAN_CONFIRMATION_REQUIRED" });
    expect(runTool("loadLearnedSkill", {}, ua)).toMatchObject({ skills: [] });

    // With the skill: refusals point to it, and Marcus's card goes through.
    await approveSkill("close-card-exceptions");
    expect(
      api("PATCH", "/transactions/txn_8820_0908", { status: "cleared" })
        .learnedSkill,
    ).toMatchObject({ name: "close-card-exceptions" });
    expect(
      runTool("loadLearnedSkill", { name: "close-card-exceptions" }, ua)
        .instructions,
    ).toContain("POST /allocations");
    const m = api("POST", "/reconciliation/sessions", {
      period: "2026-09",
      cardId: "card_8820",
    }) as { body: { id: string } };
    const ev = api("GET", "/events/evt_sales_kickoff_0918") as {
      body: { attendees: { departmentId: string; count: number }[] };
    };
    expect(ev.body.attendees).toHaveLength(2);
    const al = api(
      "POST",
      "/allocations",
      JSON.stringify({ transactionId: "txn_8820_0918" }),
    ) as { body: { id: string } };
    api("PUT", `/allocations/${al.body.id}/lines`, {
      lines: [
        { departmentId: "dept_sales", amount: 1050 },
        { departmentId: "dept_cs", amount: 600 },
      ],
    });
    api("POST", `/allocations/${al.body.id}/commit`);
    api("POST", "/journal/reclasses", {
      transactionId: "txn_8820_0908",
      fromAccount: "6100",
      toAccount: "6420",
      memo: "Notion is a software subscription.",
    });
    api("POST", "/repayments", {
      transactionId: "txn_8820_0926",
      method: "payroll_deduction",
    });
    api("POST", "/affidavits", {
      transactionId: "txn_8820_0924",
      memo: "Meter parking for the client lunch at Zuni.",
    });
    expect(
      api("POST", `/reconciliation/sessions/${m.body.id}/validate`),
    ).toMatchObject({ body: { valid: 9, total: 9 } });
    const card = runTool("reviewMatches", { sessionId: m.body.id }, ua);
    expect(card).toMatchObject({ kind: "review-card", status: "open" });
    expect(recon.cards().find((c) => c.id === "card_8820")!.closed).toBe(false);

    // Only the card's Confirm (app-only) closes the month.
    expect(
      runTool("confirmMatches", { sessionId: m.body.id }, ua),
    ).toMatchObject({ ok: true, closed: true, matched: 5, exceptions: 4 });
    expect(recon.cards().find((c) => c.id === "card_8820")!.closed).toBe(true);
    const t = learning
      .listTrajectories()
      .find((x) => x.surfaces.includes("chatgpt"));
    expect(t?.outcome).toBe("agent_succeeded");
  });
});
