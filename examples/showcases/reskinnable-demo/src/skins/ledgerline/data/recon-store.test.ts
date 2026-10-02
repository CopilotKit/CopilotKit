// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import * as ledger from "./store";
import * as recon from "./recon-store";

describe("reconciliation sessions", () => {
  beforeEach(() => ledger.reset());

  it("refuses a match outside a session", () => {
    expect(() => recon.patchTransaction("txn_4417_0908")).toThrow(
      /inside a reconciliation session/,
    );
  });

  it("validates per pair with a code only, and closes only a fully valid, current session", () => {
    const s = recon.createSession({ period: "2026-09", cardId: "card_4417" });
    recon.putPair(s.id, {
      transactionId: "txn_4417_0912",
      receiptIds: ["rcpt_nopa_0912"],
    });
    recon.putPair(s.id, {
      transactionId: "txn_4417_0915",
      receiptIds: ["rcpt_amzn_0830"],
    });
    const v = recon.validate(s.id);
    const code = (id: string) =>
      v.results.find((r) => r.transactionId === id)?.code;
    expect(code("txn_4417_0912")).toBe("UNBALANCED"); // the tip is missing
    expect(code("txn_4417_0915")).toBe("WRONG_RECEIPT"); // the August order
    expect(code("txn_4417_0908")).toBe("UNMATCHED");
    expect(() => recon.close(s.id)).toThrow(/pass validation/);

    for (const [t, r, adjustment] of [
      ["txn_4417_0908", ["rcpt_bb_0907"]],
      ["txn_4417_0912", ["rcpt_nopa_0912"], { kind: "gratuity", amount: 24.8 }],
      ["txn_4417_0915", ["rcpt_amzn_0914"]],
      [
        "txn_4417_0918",
        ["rcpt_marais_0917"],
        {
          kind: "fx_conversion",
          currency: "EUR",
          receiptAmount: 372,
          rate: 1.1086,
        },
      ],
      ["txn_4417_0922", ["rcpt_ua_tkt_0920", "rcpt_ua_plus_0920"]],
      ["txn_4417_0925", ["rcpt_wework_0925"]],
    ] as const)
      recon.putPair(s.id, { transactionId: t, receiptIds: [...r], adjustment });
    expect(recon.validate(s.id)).toMatchObject({ valid: 6, total: 6 });
    // A change after validation needs a fresh one.
    recon.putPair(s.id, {
      transactionId: "txn_4417_0908",
      receiptIds: ["rcpt_bb_0907"],
      note: "re-checked",
    });
    expect(() => recon.close(s.id)).toThrow(/pass validation/);
    recon.validate(s.id);
    expect(recon.close(s.id)).toMatchObject({ closed: true, matched: 6 });
    expect(recon.cards().find((c) => c.id === "card_4417")).toMatchObject({
      closed: true,
      unmatched: 0,
    });
  });

  it("keeps an agent's session off the person's board", () => {
    const api = recon.createSession(
      { period: "2026-09", cardId: "card_4417" },
      "api",
    );
    recon.putPair(api.id, {
      transactionId: "txn_4417_0908",
      receiptIds: ["rcpt_bb_0907"],
    });
    expect(recon.board("card_4417").session).toBeNull();
    const board = recon.createSession({
      period: "2026-09",
      cardId: "card_4417",
    });
    expect(board.id).not.toBe(api.id);
    expect(recon.board("card_4417").session?.id).toBe(board.id);
  });
});
