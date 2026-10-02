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
    // Without the skill: no direct match, unbalanced pairs, nothing to review, no close.
    expect(
      api("PATCH", "/transactions/txn_4417_0912", {
        receiptId: "rcpt_nopa_0912",
      }),
    ).toMatchObject({
      error: "SESSION_REQUIRED",
      status: 409,
    });
    const s = api("POST", "/reconciliation/sessions", {
      period: "2026-09",
      cardId: "card_4417",
    }) as {
      body: { id: string };
    };
    api("POST", `/reconciliation/sessions/${s.body.id}/pairs`, {
      transactionId: "txn_4417_0912",
      receiptIds: ["rcpt_nopa_0912"],
    });
    const v = api("POST", `/reconciliation/sessions/${s.body.id}/validate`) as {
      body: { valid: number; total: number };
    };
    expect(v.body.valid).toBeLessThan(v.body.total);
    expect(
      runTool("reviewMatches", { sessionId: s.body.id }, ua),
    ).toMatchObject({ error: "VALIDATION_FAILED" });
    expect(
      api("POST", `/reconciliation/sessions/${s.body.id}/close`),
    ).toMatchObject({
      error: "HUMAN_CONFIRMATION_REQUIRED",
    });
    // The receipts the API gives carry no tip line.
    const receipts = api("GET", "/receipts?card=card_4417") as {
      body: { receipts: Record<string, unknown>[] };
    };
    expect(Object.keys(receipts.body.receipts[0]!)).not.toContain(
      "handwrittenTip",
    );
    expect(runTool("loadLearnedSkill", {}, ua)).toMatchObject({ skills: [] });

    // With the skill: refusals point to it, and Marcus's card goes through.
    await approveSkill("match-card-receipts");
    expect(
      api("PATCH", "/transactions/txn_8820_0910").learnedSkill,
    ).toMatchObject({ name: "match-card-receipts" });
    expect(
      runTool("loadLearnedSkill", { name: "match-card-receipts" }, ua)
        .instructions,
    ).toContain("fx_conversion");
    const m = api("POST", "/reconciliation/sessions", {
      period: "2026-09",
      cardId: "card_8820",
    }) as {
      body: { id: string };
    };
    const pair = (body: Record<string, unknown>) =>
      api(
        "POST",
        `/reconciliation/sessions/${m.body.id}/pairs`,
        JSON.stringify(body),
      );
    pair({ transactionId: "txn_8820_0904", receiptIds: ["rcpt_sight_0903"] });
    pair({
      transactionId: "txn_8820_0910",
      receiptIds: ["rcpt_zuni_0910"],
      adjustment: { kind: "gratuity", amount: 16 },
    });
    pair({ transactionId: "txn_8820_0916", receiptIds: ["rcpt_amzn_0915"] });
    pair({
      transactionId: "txn_8820_0921",
      receiptIds: ["rcpt_iberia_0920"],
      adjustment: {
        kind: "fx_conversion",
        currency: "EUR",
        receiptAmount: 287,
        rate: 1.1101,
      },
    });
    pair({
      transactionId: "txn_8820_0927",
      receiptIds: ["rcpt_costco_0926a", "rcpt_costco_0926b"],
    });
    expect(
      api("POST", `/reconciliation/sessions/${m.body.id}/validate`),
    ).toMatchObject({
      body: { valid: 5, total: 5 },
    });
    const card = runTool("reviewMatches", { sessionId: m.body.id }, ua);
    expect(card).toMatchObject({ kind: "review-card", status: "open" });
    expect(recon.cards().find((c) => c.id === "card_8820")!.closed).toBe(false);

    // Only the card's Confirm (app-only) closes the month.
    expect(
      runTool("confirmMatches", { sessionId: m.body.id }, ua),
    ).toMatchObject({ ok: true, closed: true, matched: 5 });
    expect(recon.cards().find((c) => c.id === "card_8820")!.closed).toBe(true);
    const t = learning
      .listTrajectories()
      .find((x) => x.surfaces.includes("chatgpt"));
    expect(t?.outcome).toBe("agent_succeeded");
  });
});
