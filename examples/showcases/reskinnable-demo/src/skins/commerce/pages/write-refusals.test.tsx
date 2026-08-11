import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { CommerceStoreState, Operator } from "../data/types";
import { OrdersPage } from "./orders";
import { PromotionsPage } from "./promotions";
import { ReturnsPage } from "./returns";

/**
 * Every page control that WRITES must report a refusal.
 *
 * The bug this pins: four write paths across these three pages called
 * `refresh()` without looking at `res.ok`, so a 4xx repainted the identical rows
 * and the click was indistinguishable from a slow network. Every one of them is a
 * control a presenter may press on stage, and a silent no-op is the worst class
 * of demo failure — the room cannot tell whether the app is broken or slow.
 *
 * The four, and the refusal each can now genuinely receive:
 *   Orders  · hold             → 409 from the order state machine
 *   Orders  · clear exception  → 422 EXCEPTION_ON_SETTLED_ORDER
 *   Returns · approve/decline  → 409 ALREADY_DECIDED
 *   Promos  · decline          → 409 ALREADY_DECIDED
 *
 * Each is asserted three ways, because any one alone leaves the bug reachable:
 * the route's MESSAGE reaches the screen, the page does NOT go on to re-read the
 * ledger (a refresh after a refusal is the silent repaint itself), and the happy
 * path still refreshes and says nothing.
 */

// Hoisted for the same reason as `orders-clear-exception.test.tsx`: `vi.mock` is
// lifted above these imports, so a factory closing over module-scope consts would
// read them in their temporal dead zone when the pages pull the ledger context at
// import time.
const { LEDGER, OPERATOR, refresh, logStep } = vi.hoisted(() => {
  const iso = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const operator = {
    id: "op-nadia",
    name: "Nadia Okonjo",
    role: "merch-lead" as const,
    team: "Merchandising" as const,
  };
  return {
    OPERATOR: operator,
    refresh: vi.fn(async () => true),
    logStep: vi.fn(),
    LEDGER: {
      products: [
        {
          id: "bw-1",
          sku: "BW-CDR-HDY",
          name: "Cedar Hoodie",
          category: "Knitwear",
          listPrice: 120,
          unitCost: 60,
          inventory: 12,
          trailing30Units: 30,
          status: "live",
          vendor: "Cedar Mills",
        },
      ],
      // A 40% markdown on the product above trades at ~17% margin, well under
      // this floor — so the promotion below renders as the below-floor card the
      // Decline button actually lives on in the demo.
      floors: [{ category: "Knitwear", floor: 0.5, target: 0.6 }],
      orders: [
        {
          id: "ord-held",
          number: "4463",
          customerName: "Priya Raghavan",
          customerEmail: "priya@example.com",
          channel: "web",
          destination: "Lisbon, PT",
          placedAt: iso(4),
          status: "open",
          exception: "payment-declined",
          lines: [{ productId: "bw-1", quantity: 2, unitPrice: 40 }],
          total: 80,
          notes: [],
        },
      ],
      notifications: [],
      returns: [
        {
          id: "ret-1",
          orderId: "ord-held",
          orderNumber: "4463",
          customerName: "Priya Raghavan",
          productId: "bw-1",
          reason: "damaged",
          detail: "Scuffed at the cuff",
          requestedAt: iso(3),
          status: "requested",
          itemValue: 120,
          refundAmount: null,
        },
      ],
      promotions: [
        {
          id: "promo-1",
          name: "Cedar Hoodie −40%",
          productId: "bw-1",
          discountPercent: 40,
          startsAt: iso(-2),
          endsAt: iso(-16),
          submittedBy: "Ada Iyer",
          submittedAt: iso(1),
          status: "pending",
          marginWaiverId: null,
        },
      ],
      waivers: [],
      plans: [],
      operators: [operator],
    },
  };
});

vi.mock("@copilotkit/react-core/v2", () => ({ useAgentContext: () => {} }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/shell/skin-provider", () => ({
  useSkin: () => ({ id: "commerce" }),
}));

vi.mock("@/shell/skin-path", () => ({
  useSkinHref: () => (path?: string) => path ?? "/",
}));

vi.mock("../data/ledger-context", () => ({
  useCommerceLedger: () => ({
    data: LEDGER as unknown as CommerceStoreState,
    refresh,
    operator: OPERATOR as Operator,
    setOperatorId: () => {},
  }),
}));

vi.mock("../components/recording-context", () => ({
  useRecording: () => ({
    depth: 0,
    steps: [],
    beginRecording: () => {},
    endRecording: () => [],
    logStep,
  }),
}));

/** A route refusal, in the shape `data/http.ts` actually emits. */
const refusal = (status: number, message: string) =>
  vi.fn(async () => Response.json({ error: "CODE", message }, { status }));

/** A 200 whose body the page never reads. */
const accepted = () => vi.fn(async () => new Response("{}", { status: 200 }));

beforeEach(() => {
  refresh.mockClear();
  refresh.mockResolvedValue(true);
  logStep.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const click = async (label: string) => {
  const button = screen.getByLabelText(label);
  await act(async () => {
    button.click();
  });
};

const clickText = async (name: string) => {
  const button = screen.getByRole("button", { name });
  await act(async () => {
    button.click();
  });
};

describe("OrdersPage — a refused write is reported, not repainted", () => {
  it("surfaces the route's message when the hold is refused", async () => {
    vi.stubGlobal(
      "fetch",
      refusal(409, "That order cannot move to that status from where it is."),
    );

    render(<OrdersPage />);
    await click("Hold order 4463");

    expect(
      screen.getByText(
        "That order cannot move to that status from where it is.",
      ),
    ).toBeTruthy();
    // The silent repaint itself: a refused write must not go on to re-read.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("surfaces the route's message when clearing the exception is refused", async () => {
    vi.stubGlobal(
      "fetch",
      refusal(
        422,
        "A fulfilled or cancelled order cannot carry an exception — clear it in the same change.",
      ),
    );

    render(<OrdersPage />);
    await click("Clear the exception on order 4463");

    expect(
      screen.getByText(
        "A fulfilled or cancelled order cannot carry an exception — clear it in the same change.",
      ),
    ).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("falls back to a status-bearing sentence when the body carries no message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>gateway</html>", { status: 502 })),
    );

    render(<OrdersPage />);
    await click("Hold order 4463");

    expect(
      screen.getByText("That order could not be held (502)."),
    ).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("still refreshes and says nothing on the happy path", async () => {
    vi.stubGlobal("fetch", accepted());

    render(<OrdersPage />);
    await click("Hold order 4463");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("still reports a stale view when the write landed but the re-read failed", async () => {
    vi.stubGlobal("fetch", accepted());
    refresh.mockResolvedValue(false);

    render(<OrdersPage />);
    await click("Hold order 4463");

    expect(screen.getByRole("status").textContent).toContain(
      "could not be re-read",
    );
  });
});

describe("ReturnsPage — a refused decision is reported, not repainted", () => {
  it("surfaces the route's message when the return was already decided", async () => {
    vi.stubGlobal("fetch", refusal(409, "That was already decided."));

    render(<ReturnsPage />);
    await click("Approve the return on order 4463");

    expect(screen.getByText("That was already decided.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("falls back to a status-bearing sentence naming the decision", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );

    render(<ReturnsPage />);
    await click("Decline the return on order 4463");

    expect(
      screen.getByText("That return could not be declined (500)."),
    ).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("still refreshes and says nothing on the happy path", async () => {
    vi.stubGlobal("fetch", accepted());

    render(<ReturnsPage />);
    await click("Approve the return on order 4463");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("PromotionsPage — a refused decline is reported, not repainted", () => {
  it("surfaces the route's message and records the attempt as refused", async () => {
    vi.stubGlobal("fetch", refusal(409, "That was already decided."));

    render(<PromotionsPage />);
    await clickText("Decline");

    expect(screen.getByText("That was already decided.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    // The recording must not claim a decline that never landed.
    expect(logStep).toHaveBeenCalledWith(
      "Tried to decline Cedar Hoodie −40% — refused",
    );
  });

  it("still refreshes and records the decline on the happy path", async () => {
    vi.stubGlobal("fetch", accepted());

    render(<PromotionsPage />);
    await clickText("Decline");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(logStep).toHaveBeenCalledWith("Declined Cedar Hoodie −40%");
  });
});
