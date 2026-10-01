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
