import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRefundedCustomer, submitRefund } from "./refund";
import { STALE_VIEW_NOTE } from "./settle";

/**
 * BEAT 3a's write. The property under test is not "the happy path works" — it is
 * that the interrupt is settled on EVERY path. An unsettled interrupt blocks the
 * agent run indefinitely behind a card that still looks live, and nothing logs it,
 * so the only defence is a test that enumerates the ways out.
 */
const request = { id: "ret-1", customerName: "Dana Reyes" };

function ok() {
  return { ok: true, json: async () => ({}) } as unknown as Response;
}
function refused(status: number, message?: string) {
  return {
    ok: false,
    status,
    json: async () => (message ? { message } : {}),
  } as unknown as Response;
}

let respond: ReturnType<typeof vi.fn>;
let refresh: ReturnType<typeof vi.fn>;
let onIssued: ReturnType<typeof vi.fn>;

beforeEach(() => {
  respond = vi.fn(async () => {});
  // `refresh` resolves a BOOLEAN — `true` when the ledger re-read landed. A mock
  // resolving `undefined` would silently exercise the stale-view branch on the
  // happy path and pin the wrong receipt.
  refresh = vi.fn(async () => true);
  onIssued = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("submitRefund", () => {
  it("posts the amount, refreshes, and settles with a figure-free line", async () => {
    stubFetch(async () => ok());
    const failure = await submitRefund({
      request,
      amount: 42.5,
      respond,
      refresh,
      onIssued,
    });

    expect(failure).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      "/api/commerce/v1/returns/ret-1/refund",
      expect.objectContaining({ body: JSON.stringify({ amount: 42.5 }) }),
    );
    expect(refresh).toHaveBeenCalled();
    expect(onIssued).toHaveBeenCalled();
    // Beat 3a: the assistant learns THAT it happened and never the amount.
    expect(respond).toHaveBeenCalledWith(
      "Refund issued on Dana Reyes's return.",
    );
    expect(String(respond.mock.calls[0][0])).not.toContain("42.5");
  });

  it("settles with the server's reason when the refund is refused", async () => {
    stubFetch(async () => refused(422, "REFUND_EXCEEDS_CHARGE"));
    const failure = await submitRefund({
      request,
      amount: 999,
      respond,
      refresh,
      onIssued,
    });

    expect(failure).toBeNull(); // settled — the run is not wedged
    expect(respond).toHaveBeenCalledWith(
      "Could not refund Dana Reyes: REFUND_EXCEEDS_CHARGE",
    );
    expect(onIssued).not.toHaveBeenCalled();
  });

  it("falls back to the status code when the error body is unreadable", async () => {
    stubFetch(
      async () =>
        ({
          ok: false,
          status: 500,
          json: async () => {
            throw new Error("not json");
          },
        }) as unknown as Response,
    );

    await submitRefund({ request, amount: 10, respond, refresh, onIssued });
    expect(respond).toHaveBeenCalledWith("Could not refund Dana Reyes: 500");
  });

  it("STILL settles the interrupt when the fetch itself rejects", async () => {
    // The regression this whole change exists for: a rejected fetch used to
    // escape the click handler, leaving the run blocked forever.
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const failure = await submitRefund({
      request,
      amount: 10,
      respond,
      refresh,
      onIssued,
    });

    expect(failure).toBeNull();
    expect(respond).toHaveBeenCalledWith(
      "Could not refund Dana Reyes: Failed to fetch",
    );
    expect(onIssued).not.toHaveBeenCalled();
  });

  it("does not claim failure when the refund landed and only the refresh broke", async () => {
    stubFetch(async () => ok());
    refresh = vi.fn(async () => {
      throw new Error("ledger fetch failed: 503");
    });

    await submitRefund({ request, amount: 10, respond, refresh, onIssued });

    // A receipt saying the refund FAILED after the money moved is worse than no
    // receipt at all — so this still leads with "Refund issued". It also appends
    // the stale-view note, because the ledger re-read did not land and the page
    // is therefore behind. Those two are not in tension: the write succeeded and
    // the screen is out of date, and the receipt says exactly that.
    expect(respond).toHaveBeenCalledWith(
      "Refund issued on Dana Reyes's return." + STALE_VIEW_NOTE,
    );
    expect(onIssued).toHaveBeenCalled();
  });

  it("says nothing about staleness when the ledger re-read did land", async () => {
    stubFetch(async () => ok());
    refresh = vi.fn(async () => true);

    await submitRefund({ request, amount: 10, respond, refresh, onIssued });

    expect(respond).toHaveBeenCalledWith(
      "Refund issued on Dana Reyes's return.",
    );
    expect(String(respond.mock.calls[0][0])).not.toContain("reload it");
  });

  it("appends the stale-view note when the re-read resolves false", async () => {
    stubFetch(async () => ok());
    refresh = vi.fn(async () => false);

    await submitRefund({ request, amount: 10, respond, refresh, onIssued });

    expect(respond).toHaveBeenCalledWith(
      "Refund issued on Dana Reyes's return." + STALE_VIEW_NOTE,
    );
    // The refund still happened, so the replay memory is still written.
    expect(onIssued).toHaveBeenCalled();
  });

  it("reports back — and withholds the replay memory — when respond is missing", async () => {
    stubFetch(async () => ok());
    const failure = await submitRefund({
      request,
      amount: 10,
      respond: undefined,
      refresh,
      onIssued,
    });

    expect(failure).toBeTruthy();
    // The interrupt is NOT settled, so nothing may record it as answered.
    expect(onIssued).not.toHaveBeenCalled();
  });

  it("never throws, so the card's spinner can always come back down", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    respond = vi.fn(async () => {
      throw new Error("stream closed too");
    });
    await expect(
      submitRefund({ request, amount: 10, respond, refresh, onIssued }),
    ).resolves.toBeTruthy();
  });
});

/**
 * The replay half of the same contract. On thread reopen the settled sentence is
 * the ONLY record of the refund, so the card recovers the customer from it — and
 * it must recover it from every sentence `submitRefund` can actually write,
 * stale-view note included. An end-anchored reader stopped matching the day that
 * note was introduced, and a refund that really happened replayed as a failure.
 */
describe("readRefundedCustomer", () => {
  it("reads the customer back out of every success sentence submitRefund writes", async () => {
    for (const refreshed of [true, false]) {
      respond = vi.fn(async () => {});
      stubFetch(async () => ok());
      await submitRefund({
        request,
        amount: 10,
        respond,
        refresh: vi.fn(async () => refreshed),
        onIssued,
      });
      const settled = String(respond.mock.calls[0][0]);
      expect(readRefundedCustomer(settled)).toBe("Dana Reyes");
    }
  });

  it("reports no customer for a cancel or a refusal", () => {
    expect(readRefundedCustomer("The user cancelled the refund.")).toBeNull();
    expect(readRefundedCustomer("Could not refund Dana Reyes: 422")).toBeNull();
    expect(readRefundedCustomer("")).toBeNull();
  });
});
