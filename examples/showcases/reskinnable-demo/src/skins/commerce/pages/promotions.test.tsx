import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { PromotionsPage } from "./promotions";
import { JUSTIFICATION_MIN_LENGTH } from "../data/waiver-codes";
import type {
  CommerceStoreState,
  MarginWaiver,
  Operator,
  Product,
  Promotion,
} from "../data/types";

/**
 * BEAT 6's control surface, under the two things a presenter actually does to it
 * by accident: clicking twice, and getting refused.
 *
 * Both bugs this pins were on the SAME form and were the same mistake — a
 * handler that did not model its own in-flight and failure states:
 *
 *  1. `Finalize` had no in-flight guard, so a double-click fired the POST twice.
 *     The store settles a waiver once, so the second call came back
 *     `ALREADY_FINALIZED` and the card painted a REFUSAL over an action that had
 *     just succeeded. On stage the presenter is told the thing they did failed,
 *     and their only recourse is to do it again. `Approve` and `Decline` had the
 *     identical hole against `ALREADY_DECIDED`.
 *  2. `setJustification("")` ran unconditionally after filing, even though the
 *     filing helper reports refusal by RETURNING. So a refused filing wiped the
 *     sentence the merchandiser had typed. That is no longer an exotic path:
 *     the justification has a real minimum length server-side
 *     (`INVALID_JUSTIFICATION`, 422) and the input bounds only the maximum, so a
 *     short justification is refused as an ordinary case.
 *
 * The in-flight assertions use a fetch that does NOT resolve until the test says
 * so, which is what makes them deterministic: the question is only ever "while
 * write #1 is outstanding, did the second click reach the network", and that is
 * answered synchronously.
 *
 * The GUARD itself is tested apart from these buttons, beside the hook it lives in
 * — `components/use-in-flight.test.tsx`. It has to be: jsdom does not dispatch a
 * click to a `disabled` button, so everything here can only ever prove the visible
 * half of the guard.
 *
 * No `@testing-library/jest-dom` in this app, so assertions are plain DOM.
 */

const PRODUCT: Product = {
  id: "prd-cedar-hoodie",
  sku: "BW-CDR-HDY",
  name: "Cedar Hoodie",
  category: "Knitwear",
  listPrice: 100,
  unitCost: 37,
  inventory: 120,
  trailing30Units: 40,
  status: "live",
  vendor: "Northline Mills",
};

/** 40% off a $100/$37 SKU trades at 38.3% against a 45% floor — below it. */
const PROMOTION: Promotion = {
  id: "promo-cedar",
  name: "Cedar Hoodie autumn markdown",
  productId: PRODUCT.id,
  discountPercent: 40,
  startsAt: new Date(2026, 8, 1).toISOString(),
  endsAt: new Date(2026, 8, 22).toISOString(),
  submittedBy: "Theo Vance",
  submittedAt: new Date(2026, 7, 28).toISOString(),
  status: "pending",
  marginWaiverId: null,
};

/** A draft waiver, so the panel renders its `Finalize` lever. */
const DRAFT: MarginWaiver = {
  id: "wvr-1",
  promotionId: PROMOTION.id,
  code: "VENDOR-FUND",
  justification: "signed co-op on file",
  status: "draft",
  openedAt: new Date(2026, 7, 29).toISOString(),
  finalizedAt: null,
};

const OPERATOR: Operator = {
  id: "op-nadia",
  name: "Nadia Okonjo",
  role: "merch-lead",
  team: "Merchandising",
};

function ledger(waivers: MarginWaiver[] = [DRAFT]): CommerceStoreState {
  return {
    products: [PRODUCT],
    floors: [{ category: "Knitwear", floor: 0.45, target: 0.52 }],
    orders: [],
    notifications: [],
    returns: [],
    promotions: [PROMOTION],
    waivers,
    plans: [],
    operators: [OPERATOR],
  };
}

const state: { data: CommerceStoreState; refreshed: boolean; count: number } = {
  data: ledger(),
  // What `refresh()` resolves. `false` is a STALE VIEW — the write landed, the
  // re-read did not — which the page reports differently from a refusal.
  refreshed: true,
  count: 0,
};

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: () => {},
}));

vi.mock("../data/ledger-context", () => ({
  useCommerceLedger: () => ({
    data: state.data,
    refresh: async () => {
      state.count += 1;
      return state.refreshed;
    },
    operator: OPERATOR,
    setOperatorId: () => {},
  }),
}));

const steps: { label: string; data?: string }[] = [];
vi.mock("../components/recording-context", () => ({
  useRecording: () => ({
    isRecording: false,
    steps: [],
    beginRecording: () => {},
    endRecording: () => {},
    logStep: (label: string, data?: string) => steps.push({ label, data }),
    getDemonstratedCode: () => null,
    reset: () => {},
  }),
}));

// ── the stub server ─────────────────────────────────────────────────────────

interface Refusal {
  status: number;
  message: string;
  /**
   * Refuse only urls containing this fragment. Omitted, every request is refused.
   * The cross-surface cases need ONE write refused and the other accepted — that
   * is the whole shape of the bug they pin.
   */
  match?: string;
}

/** POST urls seen, in order. */
const posted: string[] = [];
/** Resolvers for responses withheld while `hold` is true. */
const withheld: (() => void)[] = [];
const server: {
  hold: boolean;
  /** Answer a REPEAT of a write the way the store's own idempotency does. */
  refuseRepeats: boolean;
  refuse: Refusal | null;
} = { hold: false, refuseRepeats: false, refuse: null };

/**
 * Decide the response AT REQUEST TIME, not at release time.
 *
 * This matters for the withheld case: both clicks of an unguarded double-click
 * are outstanding together, and if repeat-ness were computed when the responses
 * are finally released, BOTH would look like repeats and both would be refused.
 * The bug would then be invisible — the fixed code would fail too.
 */
function decide(url: string): Response {
  const repeat = posted.filter((seen) => seen === url).length > 1;
  if (server.refuseRepeats && repeat) {
    const already = url.includes("/finalize")
      ? "That waiver was already finalized."
      : "That was already decided.";
    return {
      ok: false,
      status: 409,
      json: async () => ({ message: already }),
    } as unknown as Response;
  }
  const refusal = server.refuse;
  if (refusal && (!refusal.match || url.includes(refusal.match))) {
    return {
      ok: false,
      status: refusal.status,
      json: async () => ({ message: refusal.message }),
    } as unknown as Response;
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: "VENDOR-FUND" }),
  } as unknown as Response;
}

beforeEach(() => {
  state.data = ledger();
  state.refreshed = true;
  state.count = 0;
  posted.length = 0;
  withheld.length = 0;
  steps.length = 0;
  server.hold = false;
  server.refuseRepeats = false;
  server.refuse = null;
  vi.spyOn(console, "error").mockImplementation(() => {});

  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      posted.push(url);
      const response = decide(url);
      if (!server.hold) return Promise.resolve(response);
      return new Promise<Response>((resolve) => {
        withheld.push(() => resolve(response));
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Drain the microtask queue and let React commit whatever it produced. */
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** Release every withheld response. */
const release = async () => {
  server.hold = false;
  withheld.splice(0).forEach((settle) => settle());
  await flush();
};

const callsTo = (fragment: string) =>
  posted.filter((url) => url.includes(fragment)).length;

/**
 * The refusal / stale-view line on the card. It is the only element carrying
 * `text-negative` alongside `border-negative` — the below-floor explainer above
 * it uses `text-ink` — so this reads the message and nothing else.
 */
const noticeText = () =>
  document.querySelector("p.text-negative")?.textContent ?? null;

const button = (name: string | RegExp) => screen.getByRole("button", { name });

const justificationInput = () =>
  screen.getByPlaceholderText("What is on file?") as HTMLInputElement;

/** Type into the justification field the way a merchandiser would. */
const type = (text: string) => {
  fireEvent.change(justificationInput(), { target: { value: text } });
};

describe("PromotionsPage — an in-flight write is not re-entrant", () => {
  it("fires Finalize ONCE for a double-click, and paints no error", async () => {
    server.hold = true;
    server.refuseRepeats = true;
    render(<PromotionsPage />);

    const finalize = button("Finalize");
    fireEvent.click(finalize);
    // The second click lands while write #1 is still outstanding. Before the
    // guard this reached the network, came back ALREADY_FINALIZED, and painted a
    // refusal on a card whose finalize had SUCCEEDED.
    fireEvent.click(finalize);
    expect(callsTo("/finalize")).toBe(1);

    await release();

    expect(callsTo("/finalize")).toBe(1);
    expect(noticeText()).toBeNull();
    // ...and the demonstration is recorded once, not once plus a failure.
    expect(steps).toHaveLength(1);
    expect(steps[0].label).toContain("Finalized");
  });

  it("says so on the button while the finalize is outstanding", async () => {
    server.hold = true;
    render(<PromotionsPage />);

    fireEvent.click(button("Finalize"));
    await flush();

    const busy = button("Finalizing…");
    expect(busy.hasAttribute("disabled")).toBe(true);

    await release();
    expect(button("Finalize").hasAttribute("disabled")).toBe(false);
  });

  it("fires Approve ONCE for a double-click, and paints no error", async () => {
    server.hold = true;
    server.refuseRepeats = true;
    render(<PromotionsPage />);

    const approve = button("Approve");
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(callsTo("/approve")).toBe(1);

    await release();

    expect(callsTo("/approve")).toBe(1);
    expect(noticeText()).toBeNull();
  });

  it("fires Decline ONCE for a double-click, and paints no error", async () => {
    server.hold = true;
    server.refuseRepeats = true;
    render(<PromotionsPage />);

    const decline = button("Decline");
    fireEvent.click(decline);
    fireEvent.click(decline);
    expect(callsTo("/decline")).toBe(1);

    await release();

    expect(callsTo("/decline")).toBe(1);
    expect(noticeText()).toBeNull();
  });

  it("will not let Decline start while Approve is in flight", async () => {
    server.hold = true;
    render(<PromotionsPage />);

    fireEvent.click(button("Approve"));
    fireEvent.click(button(/Decline/));
    expect(callsTo("/decline")).toBe(0);

    await release();
  });

  it("files ONE waiver for a double-click on File waiver", async () => {
    server.hold = true;
    render(<PromotionsPage />);
    type("signed co-op on file");

    const file = button("File waiver");
    fireEvent.click(file);
    fireEvent.click(file);
    expect(callsTo("/margin-waivers")).toBe(1);

    await release();
    expect(callsTo("/margin-waivers")).toBe(1);
  });

  it("will not let Finalize start while a filing is in flight", async () => {
    server.hold = true;
    render(<PromotionsPage />);
    type("signed co-op on file");

    fireEvent.click(button("File waiver"));
    fireEvent.click(button(/Finalize/));
    expect(callsTo("/finalize")).toBe(0);

    await release();
  });
});

describe("PromotionsPage — a refused filing keeps what was typed", () => {
  const TOO_SHORT = "short";

  it("preserves the justification and shows the refusal on 422", async () => {
    // The now-ordinary case: below the store's minimum length. The input bounds
    // only the MAXIMUM, so this reaches the route and is refused.
    expect(TOO_SHORT.length).toBeLessThan(JUSTIFICATION_MIN_LENGTH);
    server.refuse = {
      status: 422,
      message: "That justification is not usable.",
    };
    render(<PromotionsPage />);

    type(TOO_SHORT);
    fireEvent.click(button("File waiver"));
    await flush();

    expect(noticeText()).toBe("That justification is not usable.");
    // THE REGRESSION: this used to come back empty, so the merchandiser had to
    // retype the sentence on stage before they could re-file.
    expect(justificationInput().value).toBe(TOO_SHORT);
    // A refusal is not a demonstration step either.
    expect(steps).toHaveLength(0);
  });

  it("preserves it on a 404 too, and on a rejected fetch", async () => {
    server.refuse = { status: 404, message: "No such promotion." };
    render(<PromotionsPage />);
    type("signed co-op on file");
    fireEvent.click(button("File waiver"));
    await flush();
    expect(justificationInput().value).toBe("signed co-op on file");

    // A fetch that never completes at all must not be read as success either.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    fireEvent.click(button("File waiver"));
    await flush();
    expect(justificationInput().value).toBe("signed co-op on file");
  });

  it("DOES clear it once the filing actually lands", async () => {
    render(<PromotionsPage />);

    type("signed co-op on file");
    fireEvent.click(button("File waiver"));
    await flush();

    expect(callsTo("/margin-waivers")).toBe(1);
    expect(noticeText()).toBeNull();
    expect(justificationInput().value).toBe("");
    expect(steps[0]?.data).toBe("VENDOR-FUND");
  });

  it("still clears it for a landed filing whose ledger re-read failed", async () => {
    // `refresh()` resolving false is a STALE VIEW, not a refusal: the waiver IS
    // on file, so the typed sentence has done its job and must still clear. The
    // separate stale notice is what tells the presenter to reload — reading it as
    // a refusal and holding the text would be the mirror-image bug.
    state.refreshed = false;
    render(<PromotionsPage />);

    type("signed co-op on file");
    fireEvent.click(button("File waiver"));
    await flush();

    expect(state.count).toBe(1);
    expect(noticeText()).toMatch(/could not be re-read/);
    expect(justificationInput().value).toBe("");
  });
});

/**
 * The card has TWO write surfaces — the decision levers and the waiver panel — and
 * they used to share ONE message slot (`errors[promotion.id]`) while each held its
 * OWN `useInFlight` instance. A per-instance mutex is no help when the ERROR
 * CHANNEL is shared: whichever write finished last spoke for both, so a
 * successful waiver filing's `setError(id, null)` took away the refusal the
 * approve had just printed and the refused approve ended up saying NOTHING. That
 * is the same silent no-op the guard exists to prevent, reached through the report
 * instead of the request.
 *
 * Both halves are pinned here because each is reachable on its own:
 *  - CONCURRENTLY, because one instance per surface let the second write start
 *    while the first was still outstanding.
 *  - SEQUENTIALLY, because one slot means the later write overwrites the earlier
 *    one's outcome even when they never overlap.
 */
describe("PromotionsPage — one card's two write surfaces do not erase each other", () => {
  const REFUSED_APPROVE = "That markdown trades under the category floor.";

  it("will not let a waiver filing start while a decision is in flight", async () => {
    server.hold = true;
    server.refuse = {
      status: 422,
      message: REFUSED_APPROVE,
      match: "/approve",
    };
    render(<PromotionsPage />);
    type("signed co-op on file");

    fireEvent.click(button("Approve"));
    // Before the shared guard this reached the network, landed, and cleared the
    // refusal the approve was about to print.
    fireEvent.click(button("File waiver"));
    expect(callsTo("/margin-waivers")).toBe(0);

    await release();

    expect(screen.getByText(REFUSED_APPROVE)).toBeTruthy();
  });

  it("keeps a refused approve on screen when a LATER waiver filing succeeds", async () => {
    server.refuse = {
      status: 422,
      message: REFUSED_APPROVE,
      match: "/approve",
    };
    render(<PromotionsPage />);

    fireEvent.click(button("Approve"));
    await flush();
    expect(screen.getByText(REFUSED_APPROVE)).toBeTruthy();

    // Filing the waiver is the merchandiser's ANSWER to that refusal — it is the
    // sentence they are acting on, so a successful filing must not take it away.
    type("signed co-op on file");
    fireEvent.click(button("File waiver"));
    await flush();

    expect(callsTo("/margin-waivers")).toBe(1);
    expect(justificationInput().value).toBe("");
    expect(screen.getByText(REFUSED_APPROVE)).toBeTruthy();
  });

  it("keeps a refused filing on screen when a LATER decision succeeds", async () => {
    // The mirror: the decision surface must not speak for the waiver surface
    // either.
    server.refuse = {
      status: 422,
      message: "That justification is not usable.",
      match: "/margin-waivers",
    };
    render(<PromotionsPage />);

    type("short");
    fireEvent.click(button("File waiver"));
    await flush();
    expect(screen.getByText("That justification is not usable.")).toBeTruthy();

    fireEvent.click(button("Decline"));
    await flush();

    expect(callsTo("/decline")).toBe(1);
    expect(screen.getByText("That justification is not usable.")).toBeTruthy();
  });
});
