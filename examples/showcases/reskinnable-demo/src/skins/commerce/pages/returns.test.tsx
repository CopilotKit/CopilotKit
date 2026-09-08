import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ReturnsPage } from "./returns";
import type {
  CommerceStoreState,
  Operator,
  Product,
  ReturnRequest,
} from "../data/types";

/**
 * The returns desk's three write controls, under the three things that actually
 * happen to them: a double-click, a fetch that never answers, and a write that
 * LANDS while the follow-up re-read does not.
 *
 * BEAT 3a's refund is the money path, and it had no test of any kind. What it had
 * instead:
 *
 *  1. `RefundControl` guarded with `useState` alone and had no `try/finally`, so a
 *     rejecting fetch wedged the button on "Issuing…" permanently — mid-demo, with
 *     no way back but a reload — and a double-click POSTed twice, the second
 *     answering `ALREADY_REFUNDED` beside a refund that had landed.
 *  2. Approve/Decline had no guard at all and never disabled, so a double-click
 *     fired two PATCHes and painted `ALREADY_DECIDED` over a decision that
 *     SUCCEEDED.
 *  3. A LANDED refund whose `refresh()` failed came back as a MESSAGE, which the
 *     control read as a refusal: it kept the typed figure and re-armed the button,
 *     inviting a second refund for money that had already moved. The row still
 *     reads "approved" on a failed re-read, so the control is still on screen —
 *     this is not a theoretical branch.
 *
 * The in-flight assertions use a fetch that does NOT resolve until the test says
 * so, which is what makes them deterministic: the question is only ever "while
 * write #1 is outstanding, did the second click reach the network".
 *
 * No `@testing-library/jest-dom` in this app, so assertions are plain DOM.
 */

const PRODUCT: Product = {
  id: "prd-cedar-hoodie",
  sku: "BW-CDR-HDY",
  name: "Cedar Hoodie",
  category: "Knitwear",
  listPrice: 120,
  unitCost: 44,
  inventory: 60,
  trailing30Units: 30,
  status: "live",
  vendor: "Northline Mills",
};

const OPERATOR: Operator = {
  id: "op-nadia",
  name: "Nadia Okonjo",
  role: "merch-lead",
  team: "Merchandising",
};

/** Days ago, kept under 7 so no row paints an aging figure in `text-negative`. */
const iso = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString();

/** Approved and unrefunded — the one row that renders `RefundControl`. */
const APPROVED: ReturnRequest = {
  id: "ret-approved",
  orderId: "ord-1",
  orderNumber: "4463",
  customerName: "Priya Raghavan",
  productId: PRODUCT.id,
  reason: "damaged",
  detail: "Scuffed at the cuff",
  requestedAt: iso(3),
  status: "approved",
  itemValue: 120,
  refundAmount: null,
};

/** Two undecided rows, so a decision on one can be raced against the other. */
const REQUESTED: ReturnRequest = {
  ...APPROVED,
  id: "ret-requested",
  orderNumber: "5501",
  customerName: "Ines Duarte",
  status: "requested",
  requestedAt: iso(2),
};

const OTHER_REQUESTED: ReturnRequest = {
  ...REQUESTED,
  id: "ret-other",
  orderNumber: "5502",
  customerName: "Theo Vance",
  requestedAt: iso(1),
};

function ledger(): CommerceStoreState {
  return {
    products: [PRODUCT],
    floors: [{ category: "Knitwear", floor: 0.45, target: 0.52 }],
    orders: [],
    notifications: [],
    returns: [APPROVED, REQUESTED, OTHER_REQUESTED],
    promotions: [],
    waivers: [],
    plans: [],
    operators: [OPERATOR],
  };
}

const state: { data: CommerceStoreState; refreshed: boolean; count: number } = {
  data: ledger(),
  // What `refresh()` resolves. `false` is a STALE VIEW — the write landed, the
  // re-read did not — which this page must report differently from a refusal.
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

// ── the stub server ─────────────────────────────────────────────────────────

interface Refusal {
  status: number;
  message: string;
}

/** Request urls seen, in order. */
const posted: string[] = [];
/** Resolvers for responses withheld while `hold` is true. */
const withheld: (() => void)[] = [];
const server: {
  hold: boolean;
  /** Answer a REPEAT of a write the way the store's own idempotency does. */
  refuseRepeats: boolean;
  refuse: Refusal | null;
  reject: boolean;
} = { hold: false, refuseRepeats: false, refuse: null, reject: false };

/**
 * Decide the response AT REQUEST TIME, not at release time — same reason as
 * `promotions.test.tsx`: both clicks of an unguarded double-click are outstanding
 * together, so computing repeat-ness at release time would refuse both and make
 * the bug invisible.
 */
function decide(url: string): Response {
  const repeat = posted.filter((seen) => seen === url).length > 1;
  if (server.refuseRepeats && repeat) {
    const already = url.endsWith("/refund")
      ? "That return has already been refunded."
      : "That was already decided.";
    return {
      ok: false,
      status: 409,
      json: async () => ({ message: already }),
    } as unknown as Response;
  }
  const refusal = server.refuse;
  if (refusal) {
    return {
      ok: false,
      status: refusal.status,
      json: async () => ({ message: refusal.message }),
    } as unknown as Response;
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
  } as unknown as Response;
}

beforeEach(() => {
  state.data = ledger();
  state.refreshed = true;
  state.count = 0;
  posted.length = 0;
  withheld.length = 0;
  server.hold = false;
  server.refuseRepeats = false;
  server.refuse = null;
  server.reject = false;
  vi.spyOn(console, "error").mockImplementation(() => {});

  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      posted.push(url);
      if (server.reject)
        return Promise.reject(new TypeError("Failed to fetch"));
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

/** Requests whose url ends exactly here — `/refund` is a suffix of no other. */
const callsEndingIn = (suffix: string) =>
  posted.filter((url) => url.endsWith(suffix)).length;

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const maybeButton = (name: string | RegExp) =>
  screen.queryByRole("button", { name });
const labelled = (label: string) => screen.getByLabelText(label);

const amountInput = () =>
  screen.getByPlaceholderText(/^up to /) as HTMLInputElement;

const type = (text: string) => {
  fireEvent.change(amountInput(), { target: { value: text } });
};

describe("RefundControl — the money path cannot fire twice or latch", () => {
  it("POSTs the refund ONCE for a double-click", async () => {
    server.hold = true;
    server.refuseRepeats = true;
    render(<ReturnsPage />);
    type("50");

    const issue = button("Issue refund");
    fireEvent.click(issue);
    // The second click lands while write #1 is still outstanding. Unguarded this
    // reached the network, came back ALREADY_REFUNDED, and printed a refusal
    // beside a refund that had really moved money.
    fireEvent.click(issue);
    expect(callsEndingIn("/refund")).toBe(1);

    await release();
    expect(callsEndingIn("/refund")).toBe(1);
    expect(screen.queryByText(/already been refunded/)).toBeNull();
  });

  it("says so on the button while the refund is outstanding", async () => {
    server.hold = true;
    render(<ReturnsPage />);
    type("50");

    fireEvent.click(button("Issue refund"));
    await flush();

    const busy = button("Issuing…");
    expect(busy.hasAttribute("disabled")).toBe(true);

    await release();
  });

  it("does NOT latch on 'Issuing…' when the fetch never answers", async () => {
    server.reject = true;
    render(<ReturnsPage />);
    type("50");

    fireEvent.click(button("Issue refund"));
    await flush();

    // THE LATCH: no `finally`, so the button used to sit on "Issuing…" for the
    // rest of the demo with no way back but a reload.
    expect(maybeButton("Issuing…")).toBeNull();
    // Nothing moved, so the control is armed again — and it has to SAY why,
    // or a dead-looking button is all the operator gets.
    expect(button("Issue refund").hasAttribute("disabled")).toBe(false);
    expect(amountInput().value).toBe("50");
    expect(screen.getByText(/did not go through/)).toBeTruthy();
  });

  it("keeps the typed figure and re-arms when the refund is REFUSED", async () => {
    server.refuse = { status: 422, message: "That is over what was charged." };
    render(<ReturnsPage />);
    type("50");

    fireEvent.click(button("Issue refund"));
    await flush();

    expect(screen.getByText("That is over what was charged.")).toBeTruthy();
    // Nothing moved: the figure stays typed and the button is live again.
    expect(amountInput().value).toBe("50");
    expect(button("Issue refund").hasAttribute("disabled")).toBe(false);
    expect(state.count).toBe(0);
  });

  it("will not re-arm after a refund that LANDED, even if a new figure is typed", async () => {
    render(<ReturnsPage />);
    type("50");

    fireEvent.click(button("Issue refund"));
    await flush();

    expect(callsEndingIn("/refund")).toBe(1);
    expect(amountInput().value).toBe("");
    // The row only leaves this control's branch once the ledger re-read lands. If
    // anything keeps it on screen, it must NOT invite a second refund for money
    // that already moved — so typing a fresh figure does not bring the button
    // back.
    type("25");
    expect(
      button(/Issue refund|Refund issued|Issuing…/).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("reports a LANDED refund whose re-read failed as done-but-behind, not as a refusal", async () => {
    // The money moved and only the ledger re-read failed. The row still reads
    // "approved", so this control is still rendered — and the one thing it must
    // not do is look like a refusal and invite a second attempt.
    state.refreshed = false;
    render(<ReturnsPage />);
    type("50");

    fireEvent.click(button("Issue refund"));
    await flush();

    expect(state.count).toBe(1);
    expect(screen.getByText(/could not be re-read/)).toBeTruthy();
    // The two halves that separate "it happened, the page is behind" from "it was
    // refused": the figure is spent, and the button does not come back.
    expect(amountInput().value).toBe("");
    type("25");
    expect(
      button(/Issue refund|Refund issued|Issuing…/).hasAttribute("disabled"),
    ).toBe(true);
    expect(callsEndingIn("/refund")).toBe(1);
  });
});

describe("ReturnsPage — a decision cannot fire twice or latch", () => {
  const APPROVE = "Approve the return on order 5501";
  const DECLINE = "Decline the return on order 5501";
  const OTHER_APPROVE = "Approve the return on order 5502";

  it("PATCHes ONCE for a double-clicked Approve, and paints no error", async () => {
    server.hold = true;
    server.refuseRepeats = true;
    render(<ReturnsPage />);

    const approve = labelled(APPROVE);
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(callsEndingIn("/ret-requested")).toBe(1);

    await release();
    expect(callsEndingIn("/ret-requested")).toBe(1);
    // ALREADY_DECIDED printed over a decision that succeeded is the whole bug.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("disables both decision levers while one is outstanding", async () => {
    server.hold = true;
    render(<ReturnsPage />);

    fireEvent.click(labelled(APPROVE));
    await flush();

    expect(labelled(APPROVE).hasAttribute("disabled")).toBe(true);
    expect(labelled(DECLINE).hasAttribute("disabled")).toBe(true);

    await release();
    expect(labelled(APPROVE).hasAttribute("disabled")).toBe(false);
  });

  it("will not let Decline start while Approve is in flight", async () => {
    server.hold = true;
    render(<ReturnsPage />);

    fireEvent.click(labelled(APPROVE));
    fireEvent.click(labelled(DECLINE));
    expect(posted).toHaveLength(1);

    await release();
  });

  it("will not let a SECOND row's decision start either — they share one notice", async () => {
    // The page has exactly one place to speak, so two decisions in flight
    // together means the second one's outcome overwrites (or erases) the first's.
    // The guard is page-wide for precisely that reason.
    server.hold = true;
    render(<ReturnsPage />);

    fireEvent.click(labelled(APPROVE));
    fireEvent.click(labelled(OTHER_APPROVE));
    expect(callsEndingIn("/ret-other")).toBe(0);

    await release();
  });

  it("does not latch, and speaks, when the decision fetch never answers", async () => {
    server.reject = true;
    render(<ReturnsPage />);

    fireEvent.click(labelled(APPROVE));
    await flush();

    expect(labelled(APPROVE).hasAttribute("disabled")).toBe(false);
    // A write that vanished with the page silent is the same dead button as a
    // refusal nobody printed.
    expect(screen.getByRole("status").textContent).toMatch(
      /nothing came back/i,
    );
    expect(state.count).toBe(0);
  });
});
