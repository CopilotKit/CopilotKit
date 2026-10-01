// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import * as ledger from "../data/store";
import * as learning from "../learning/store";
import { approveSkill } from "../learning/service";
import { runTool } from "./handlers";

describe("the Ledgerline MCP tools", () => {
  beforeEach(() => {
    ledger.reset();
    learning.reset();
  });

  it("fail on POL-114 with no skill, then succeed once the skill is published", async () => {
    const ua = "openai-mcp/1.0.0";
    const refused = runTool("approveReport", { reportId: "EXP-2291" }, ua);
    expect(refused).toMatchObject({ error: "POLICY_HOLD", code: "POL-114" });
    expect(refused.learnedSkill).toBeUndefined();
    expect(runTool("loadLearnedSkill", {}, ua)).toMatchObject({ skills: [] });

    await approveSkill("approve-team-event-expense");
    const again = runTool("approveReport", { reportId: "EXP-2291" }, ua);
    expect(again.learnedSkill).toMatchObject({
      name: "approve-team-event-expense",
    });
    expect(
      runTool("loadLearnedSkill", { name: "approve-team-event-expense" }, ua)
        .instructions,
    ).toContain("CC-410");
    runTool(
      "allocateCostCenter",
      { reportId: "EXP-2291", costCenterId: "CC-410" },
      ua,
    );
    expect(
      runTool("approveReport", { reportId: "EXP-2291" }, ua),
    ).toMatchObject({ status: "approved" });
    expect(
      runTool("reimburseReport", { reportId: "EXP-2291" }, ua),
    ).toMatchObject({ status: "reimbursed" });

    const [t] = learning
      .listTrajectories()
      .filter((x) => !x.trajectoryId.startsWith("trj_hist"));
    const d = learning.trajectoryDetail(t!.trajectoryId)!;
    const thread = d.threads.find((x) => x.surface === "chatgpt")!;
    expect(thread.linkStrength).toBe("weak");
    expect(thread.agentTrace.map((e) => e.name)).toContain(
      "allocateCostCenter",
    );
  });
});

describe("the MCP app tools", () => {
  beforeEach(() => {
    ledger.reset();
    learning.reset();
  });

  it("open the report card and approve card views, and confirm only once the hold is clear", () => {
    const ua = "openai-mcp/1.0.0";
    expect(runTool("getReport", { reportId: "EXP-2291" }, ua)).toMatchObject({
      kind: "report-card",
      report: { id: "EXP-2291" },
    });
    const held = runTool("approveAndReimburse", { reportId: "EXP-2291" }, ua);
    expect(held).toMatchObject({ error: "POLICY_HOLD", code: "POL-114" });
    expect(held.kind).toBeUndefined();
    const refused = runTool(
      "confirmApproveAndReimburse",
      { reportId: "EXP-2291" },
      ua,
    );
    expect(refused).toMatchObject({
      ok: false,
      error: "POLICY_HOLD",
      code: "POL-114",
    });
    expect(JSON.stringify(refused)).not.toMatch(/events cost center|CC-410/);
    runTool(
      "allocateCostCenter",
      { reportId: "EXP-2291", costCenterId: "CC-410" },
      ua,
    );
    expect(
      runTool("approveAndReimburse", { reportId: "EXP-2291" }, ua),
    ).toMatchObject({ kind: "approve-card" });
    expect(
      runTool("confirmApproveAndReimburse", { reportId: "EXP-2291" }, ua),
    ).toMatchObject({ ok: true, status: "reimbursed" });
    const [t] = learning
      .listTrajectories()
      .filter((x) => !x.trajectoryId.startsWith("trj_hist"));
    expect(t?.outcome).toBe("agent_succeeded");
    const thread = learning.trajectoryDetail(t!.trajectoryId)!.threads[0]!;
    expect(
      thread.agentTrace.filter((e) => e.status === "error").length,
    ).toBeGreaterThanOrEqual(2);
  });
});
