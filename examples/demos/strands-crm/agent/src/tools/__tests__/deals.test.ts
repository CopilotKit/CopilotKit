import { describe, it, expect } from "vitest";
import {
  moveStageTool,
  updateDealTool,
  briefDealTool,
  markWonTool,
} from "../deals.js";
import { logActivityTool } from "../activity.js";

describe("CRM tools", () => {
  it("move_stage invokes the store", async () => {
    const r = await moveStageTool.invoke({ dealId: "d3", stage: "Qualified" });
    expect((r as any).stage).toBe("Qualified");
  });

  it("update_deal patches fields", async () => {
    const r = await updateDealTool.invoke({ dealId: "d1", amount: 99000 });
    expect((r as any).amount).toBe(99000);
  });

  it("brief_deal returns a DealBrief", async () => {
    const r = await briefDealTool.invoke({ dealId: "d2" });
    expect((r as any).accountName).toBe("Globex");
  });

  it("mark_won closes the deal", async () => {
    const r = await markWonTool.invoke({ dealId: "d5" });
    expect((r as any).stage).toBe("Closed Won");
  });

  it("log_activity appends a note", async () => {
    const r = await logActivityTool.invoke({
      dealId: "d1",
      type: "note",
      body: "hi",
    });
    expect((r as any).body).toBe("hi");
  });
});
