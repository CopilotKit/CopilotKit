import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { NextRequest } from "next/server";
import { PATCH } from "@/app/api/commerce/v1/orders/[id]/route";
import * as store from "./data/store";
import type { CommerceStoreState, Operator, Order } from "./data/types";
import { OrdersPage } from "./pages/orders";

/**
 * "Clear the exception" must clear the exception and NOTHING else.
 *
 * The bug this pins: the Orders page's clear button PATCHed
 * `{ status: "open", exception: "none" }`, and the route REQUIRED a status, so
 * clearing the flag on a held order also released the hold. That is beat 5's
 * first write silently reverted by a control whose label promises one thing — and
 * it is unrecoverable on stage, because the room watches the status pill flip
 * back to `open` and concludes the stored procedure did not stick.
 *
 * Covered at two boundaries, because either one alone leaves the bug reachable:
 * the ROUTE (a status-free PATCH must be accepted and must not move the status)
 * and the PAGE (the button must actually send a status-free body — a page that
 * re-added `status` would pass every route assertion below).
 */

// ── Mocks for the page half. Declared through `vi.hoisted` because `vi.mock` is
// hoisted above the imports, so a factory closing over ordinary module-scope
// consts would read them in their temporal dead zone when `./pages/orders`
// pulls the ledger context at import time.
const { LEDGER, OPERATOR, refresh } = vi.hoisted(() => {
  const operator = {
    id: "op-nadia",
    name: "Nadia Okonjo",
    role: "merch-lead" as const,
    team: "Merchandising",
  };
  const row = (overrides: Record<string, unknown>) => ({
    id: "ord-9001",
    number: "9001",
    customerName: "Priya Raghavan",
    customerEmail: "priya@example.com",
    channel: "web",
    destination: "Lisbon, PT",
    placedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    status: "open",
    exception: "none",
    lines: [{ productId: "bw-1", quantity: 2, unitPrice: 40 }],
    total: 80,
    notes: [],
    ...overrides,
  });
  return {
    OPERATOR: operator,
    // `Promise<boolean>`, per the ledger context's contract: `true` is "a fresh
    // snapshot was committed". This was `async () => {}` — a `Promise<void>`,
    // which `vi.mock` does not type-check — so `undefined` was falsy and the
    // "happy path" click below silently took the page's STALE-VIEW branch.
    refresh: vi.fn(async () => true),
    LEDGER: {
      products: [],
      floors: [],
      orders: [
        row({
          id: "ord-held",
          number: "4463",
          status: "on-hold",
          exception: "payment-declined",
        }),
        row({ id: "ord-clean", number: "4412" }),
      ],
      notifications: [],
      returns: [],
      promotions: [],
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

vi.mock("./data/ledger-context", () => ({
  useCommerceLedger: () => ({
    data: LEDGER as unknown as CommerceStoreState,
    refresh,
    operator: OPERATOR as Operator,
    setOperatorId: () => {},
  }),
}));

// ── Part 1: the route boundary, against the real store ──────────────────────

const patch = (id: string, body: unknown) =>
  PATCH({ json: async () => body } as unknown as NextRequest, {
    params: Promise.resolve({ id }),
  });

/**
 * Referenced by ID, not by number.
 *
 * Order numbers are re-spaceable data — the seed is required to keep "older means
 * lower" and may renumber freely to do it, and it has. A test pinned to a number
 * fails as `NOT_FOUND` when that happens, which says nothing about the behaviour
 * under test. Ids are the stable handle; the comments record the SHAPE each
 * constant needs so a future reseed can repoint them here.
 */
/** Seeded on-hold order, exception `payment-declined`. */
const HELD = "ord-4423";
/** Seeded open order, exception `fraud-review` — beat 5's subject. */
const OPEN = "ord-4471";

beforeEach(() => store.reset());
afterEach(() => cleanup());

describe("PATCH orders/[id] — clearing an exception leaves the status alone", () => {
  it("keeps an ON-HOLD order on hold while clearing its exception", async () => {
    expect(store.order(HELD)?.status).toBe("on-hold");
    expect(store.order(HELD)?.exception).toBe("payment-declined");

    const res = await patch(HELD, { exception: "none" });
    expect(res.status).toBe(200);

    expect(store.order(HELD)?.exception).toBe("none");
    // The finding itself, in one assertion.
    expect(store.order(HELD)?.status).toBe("on-hold");
  });

  it("survives beat 5's hold → notify → note chain, then a clear", async () => {
    // Write 1: the hold.
    const held = await patch(OPEN, {
      status: "on-hold",
      exception: "oversell",
    });
    expect(held.status).toBe(200);
    // Write 2: the customer notification. Write 3: the forced-🚨 note.
    store.notifyCustomer(OPEN, "verification-required", "Nadia Okonjo");
    store.addOrderNote(OPEN, "🚨 Held pending verification.", "Nadia Okonjo");

    // Now someone clears the flag from the Orders page.
    expect((await patch(OPEN, { exception: "none" })).status).toBe(200);

    const after = store.order(OPEN) as Order;
    expect(after.exception).toBe("none");
    // All three of beat 5's writes are still standing.
    expect(after.status).toBe("on-hold");
    expect(after.notes[0]?.text).toBe("🚨 Held pending verification.");
    expect(store.notifications()[0]?.orderId).toBe("ord-4471");
  });

  it("still honours a status-only PATCH, preserving the exception", async () => {
    const res = await patch(OPEN, { status: "on-hold" });
    expect(res.status).toBe(200);
    expect(store.order(OPEN)?.status).toBe("on-hold");
    expect(store.order(OPEN)?.exception).toBe("fraud-review");
  });

  it("still applies status and exception together (beat 5's first write)", async () => {
    const res = await patch(OPEN, { status: "on-hold", exception: "oversell" });
    expect(res.status).toBe(200);
    expect(store.order(OPEN)?.status).toBe("on-hold");
    expect(store.order(OPEN)?.exception).toBe("oversell");
  });

  it("refuses an empty PATCH rather than reporting a write it did not make", async () => {
    const res = await patch(HELD, {});
    expect(res.status).toBe(400);
    expect(store.order(HELD)?.status).toBe("on-hold");
    expect(store.order(HELD)?.exception).toBe("payment-declined");
  });

  it("refuses an off-vocabulary exception sent WITHOUT a status", async () => {
    const res = await patch(HELD, { exception: "sounds-plausible" });
    expect(res.status).toBe(400);
    expect(store.order(HELD)?.exception).toBe("payment-declined");
  });

  it("404s a status-free clear against an unknown order", async () => {
    const res = await patch("no-such-order", { exception: "none" });
    expect(res.status).toBe(404);
  });
});

// ── Part 2: the page boundary — what the button actually sends ───────────────

describe("OrdersPage — the clear-exception button's request", () => {
  it("PATCHes the exception ONLY, with no status field", () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<OrdersPage />);
    const button = screen.getByLabelText(
      "Clear the exception on order 4463",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    act(() => button.click());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/commerce/v1/orders/ord-held");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({ exception: "none" });
    // Explicit: the key must be ABSENT, not merely equal to the current status.
    expect("status" in body).toBe(false);

    vi.unstubAllGlobals();
  });

  it("disables the control where clearing is meaningless (no exception)", () => {
    render(<OrdersPage />);
    const clean = screen.getByLabelText(
      "Clear the exception on order 4412",
    ) as HTMLButtonElement;
    expect(clean.disabled).toBe(true);
  });
});
