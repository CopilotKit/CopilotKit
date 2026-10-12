// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import * as ledger from "./store";
import * as recon from "./recon-store";
import { agentApi } from "./agent-api";

/** Clear Priya's four exceptions the way the board does. */
function clearPriya(origin: recon.Origin) {
  const al = recon.createAllocation({ transactionId: "txn_4417_0919" }, origin);
  recon.setAllocationLines(
    al.id,
    {
      lines: [
        { departmentId: "dept_eng", amount: 1200 },
        { departmentId: "dept_design", amount: 600 },
        { departmentId: "dept_product", amount: 600 },
      ],
    },
    origin,
  );
  recon.commitAllocation(al.id, origin);
  recon.createReclass(
    {
      transactionId: "txn_4417_0910",
      fromAccount: "6100",
      toAccount: "6420",
      memo: "Figma is design software.",
    },
    origin,
  );
  recon.createRepayment(
    { transactionId: "txn_4417_0927", method: "payroll_deduction" },
    origin,
  );
  recon.createAffidavit(
    {
      transactionId: "txn_4417_0923",
      memo: "Ride to O'Hare after the onsite.",
    },
    origin,
  );
}

describe("the month-end close", () => {
  beforeEach(() => ledger.reset());

  it("refuses edits to a charge with the rule for its exception, never the workflow", () => {
    const code = (id: string, body: Record<string, unknown> = {}) => {
      try {
        recon.patchTransaction(id, body);
      } catch (e) {
        return (e as ledger.LedgerError).code;
      }
    };
    expect(code("txn_4417_0910", { status: "cleared" })).toBe(
      "PERIOD_SOFT_LOCKED",
    );
    expect(code("txn_4417_0919", { status: "cleared" })).toBe(
      "ALLOCATION_REQUIRED",
    );
    expect(code("txn_4417_0927", { status: "cleared" })).toBe("NOT_EDITABLE");
    expect(code("txn_4417_0923", { status: "cleared" })).toBe(
      "RECEIPT_REQUIRED",
    );
    expect(code("txn_4417_0919", { glAccount: "6420" })).toBe(
      "PERIOD_SOFT_LOCKED",
    );
    expect(agentApi("PATCH", "/transactions/txn_4417_0910", {}).status).toBe(
      423,
    );
  });

  it("auto-matches receipts, validates exceptions per charge, and closes only a fully valid, current session", () => {
    const s = recon.createSession({ period: "2026-09", cardId: "card_4417" });
    expect(Object.values(s.pairs).every((p) => p.auto)).toBe(true);
    expect(Object.keys(s.pairs)).toHaveLength(6);
    const v = recon.validate(s.id);
    expect(v).toMatchObject({ valid: 6, total: 10 });
    expect(
      v.results.filter((r) => !r.valid).every((r) => r.code === "UNRESOLVED"),
    ).toBe(true);
    expect(() => recon.close(s.id)).toThrow(/pass validation/);

    // A wrong reclass is caught by validation.
    recon.createReclass(
      {
        transactionId: "txn_4417_0910",
        fromAccount: "6100",
        toAccount: "6500",
        memo: "Office supplies?",
      },
      "board",
    );
    clearPriya("board");
    expect(recon.validate(s.id)).toMatchObject({ valid: 10, total: 10 });
    expect(recon.close(s.id)).toMatchObject({
      closed: true,
      matched: 6,
      exceptions: 4,
    });
    expect(recon.cards().find((c) => c.id === "card_4417")).toMatchObject({
      closed: true,
      attention: 0,
    });
  });

  it("rejects an allocation that does not add up, and a split that ignores the attendees", () => {
    const s = recon.createSession({ period: "2026-09", cardId: "card_4417" });
    const al = recon.createAllocation(
      { transactionId: "txn_4417_0919" },
      "board",
    );
    expect(() =>
      recon.setAllocationLines(
        al.id,
        { lines: [{ departmentId: "dept_eng", amount: 100 }] },
        "board",
      ),
    ).toThrow(/do not add up/);
    recon.setAllocationLines(
      al.id,
      {
        lines: [
          { departmentId: "dept_eng", amount: 800 },
          { departmentId: "dept_design", amount: 800 },
          { departmentId: "dept_product", amount: 800 },
        ],
      },
      "board",
    );
    recon.commitAllocation(al.id, "board");
    const r = recon
      .validate(s.id)
      .results.find((x) => x.transactionId === "txn_4417_0919");
    expect(r).toMatchObject({ valid: false, code: "WRONG_SPLIT" });
  });

  it("keeps an agent's session and resolutions off the person's board", () => {
    const api = recon.createSession(
      { period: "2026-09", cardId: "card_4417" },
      "api",
    );
    clearPriya("api");
    expect(recon.validate(api.id)).toMatchObject({ valid: 10, total: 10 });
    expect(recon.board("card_4417").session).toBeNull();
    expect(
      recon.board("card_4417").transactions.filter((t) => t.resolution),
    ).toHaveLength(0);
    const board = recon.createSession({
      period: "2026-09",
      cardId: "card_4417",
    });
    expect(board.id).not.toBe(api.id);
    expect(recon.validate(board.id)).toMatchObject({ valid: 6, total: 10 });
  });
  it("closes Sofia's card through the same four workflows, and reports the close status per origin", () => {
    const s = recon.createSession(
      { period: "2026-09", cardId: "card_3391" },
      "api",
    );
    expect(recon.validate(s.id)).toMatchObject({ valid: 5, total: 9 });
    expect(recon.closeStatus("card_3391", "api")).toMatchObject({
      total: 9,
      ready: 5,
      autoMatched: { count: 5 },
    });
    const al = recon.createAllocation(
      { transactionId: "txn_3391_0917" },
      "api",
    );
    recon.setAllocationLines(
      al.id,
      {
        lines: [
          { departmentId: "dept_design", amount: 600 },
          { departmentId: "dept_marketing", amount: 720 },
        ],
      },
      "api",
    );
    recon.commitAllocation(al.id, "api");
    recon.createReclass(
      {
        transactionId: "txn_3391_0909",
        fromAccount: "6100",
        toAccount: "6420",
        memo: "Canva is design software.",
      },
      "api",
    );
    recon.createRepayment(
      { transactionId: "txn_3391_0928", method: "payroll_deduction" },
      "api",
    );
    recon.createAffidavit(
      { transactionId: "txn_3391_0922", memo: "Ride from SFO after Lisbon." },
      "api",
    );
    expect(recon.validate(s.id)).toMatchObject({ valid: 9, total: 9 });
    const st = recon.closeStatus("card_3391", "api");
    expect(st.ready).toBe(9);
    expect(st.exceptions.every((x) => x.status === "cleared")).toBe(true);
    // The agent's work never shows as the person's.
    expect(
      recon
        .closeStatus("card_3391", "board")
        .exceptions.every((x) => x.status === "needs_you"),
    ).toBe(true);
  });
});
