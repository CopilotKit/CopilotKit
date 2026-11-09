import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { OrdersPage, parseTopLever } from "./orders";
import * as store from "../data/store";
import type { CommerceStoreState, Order } from "../data/types";

/**
 * BEAT 3c — the `top` lever, and specifically what it does with a value it
 * cannot honour.
 *
 * `Math.max(1, Number(topParam) || 0)` shipped here, so `?top=abc`, `?top=0` and
 * `?top=-3` all rendered a ONE-ROW queue. That is the one failure mode this beat
 * cannot survive: a single row looks exactly like a legitimately narrow filter
 * result, so a broken lever and a working one are indistinguishable to the room.
 * An unusable value must therefore behave as if the lever were ABSENT — full
 * list, "Top 10" control untinted — while `?top=10` must still truncate.
 *
 * No `@testing-library/jest-dom` in this app, so assertions are plain DOM.
 */

// The page reads its levers off `useSearchParams`; drive that deterministically.
const query = { value: "" };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => new URLSearchParams(query.value),
}));
// The page registers a readable; the shell provider is not in this tree. The
// beat-3b tests below read the value the page hands it, so record it rather than
// dropping it.
const readable = { value: "" };
vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: ({ value }: { value: string }) => {
    readable.value = value;
  },
}));
// `useSkinHref(skin.id)` is the real thing (unlocked → "/commerce"); only the
// identity it needs is stubbed, since no SkinProvider is mounted here.
vi.mock("@/shell/skin-provider", () => ({
  useSkin: () => ({ id: "commerce" }),
}));
// Serve the page the real seeded ledger — the counts these tests measure are the
// seed's, and the whole point of the `top=10` case is that the seed has more. A
// test that needs MORE rows than the seed carries (the readable/panel identity
// tests) sets `ledgerOverride` instead; read lazily, at render, so the hoisted
// factory never touches it before this module finishes evaluating.
const ledgerOverride: { value: CommerceStoreState | null } = { value: null };

/**
 * What this page's `refresh()` reports, and how often it was asked.
 *
 * `refreshed: false` is a STALE VIEW — the write landed, the re-read did not (see
 * `refresh`'s contract in `data/ledger-context`) — which the page must report
 * differently from a refusal. It is a knob rather than a constant because the
 * mock was `async () => {}`: a `Promise<void>` against a `Promise<boolean>`
 * contract, which `vi.mock` does not type-check, so `undefined` was falsy and
 * every write silently took the stale branch while the "happy path" looked green.
 */
const ledgerState = { refreshed: true, refreshes: 0 };

vi.mock("../data/ledger-context", async () => {
  const ledger = await import("../data/store");
  return {
    useCommerceLedger: () => ({
      data: ledgerOverride.value ?? ledger.snapshot(),
      refresh: async () => {
        ledgerState.refreshes += 1;
        return ledgerState.refreshed;
      },
    }),
  };
});

/**
 * The queue's rendered rows. The queue's `<ul>` is the page's only unclassed
 * one — the customer-notifications list carries `divide-y` — so this counts
 * order rows and nothing else.
 */
const rowCount = () => document.querySelectorAll("ul:not([class]) > li").length;

/** The order numbers rendered in the queue, in the order shown. */
const renderedOrderNumbers = () =>
  Array.from(document.querySelectorAll("ul:not([class]) > li")).map(
    (li) => li.querySelector("p .bw-num")?.textContent?.replace("#", "") ?? "",
  );

/**
 * The order numbers rendered in the customer-notifications log, in order. That
 * log is the page's only CLASSED `<ul>` (`divide-y`), the mirror of `rowCount`'s
 * unclassed-`<ul>` selector.
 */
const renderedNotificationOrders = () =>
  Array.from(document.querySelectorAll("ul.divide-y > li")).map(
    (li) => li.querySelector(".bw-num")?.textContent?.replace("#", "") ?? "",
  );

/** What the page most recently handed `useAgentContext`, parsed. */
const readableValue = () =>
  JSON.parse(readable.value) as {
    matchingCount: number;
    visibleCount: number;
    book: { totalOrders: number };
    rows: { number: string }[];
    recentNotifications: { order: string; template: string }[];
  };

/**
 * The queue's count caption — "Top 10 of 13" with a limit, "13 orders" without.
 * Anchored so it cannot match a KPI card or an ancestor's concatenated text.
 */
const queueCaption = () =>
  screen.getByText(/^(Top \d+ of \d+|\d+ orders)$/).textContent;

/** Is the "Top 10" control tinted (`activeSelectClass(true)`)? */
const topTenActive = () =>
  screen
    .getByRole("button", { name: "Top 10" })
    .className.includes("bg-brand-soft");

/** Render the Orders page with a given query string. */
function renderAt(search: string) {
  cleanup();
  query.value = search;
  render(<OrdersPage />);
}

/** The rows the beat's view holds with NO limit applied: every exception order. */
const EXCEPTION_ROWS = store
  .snapshot()
  .orders.filter((o) => o.exception !== "none").length;

/** The lever set beat 3c actually builds, minus the limit. */
const BEAT_VIEW = "exception=any&sort=aging_desc";

beforeEach(() => {
  ledgerOverride.value = null;
  readable.value = "";
  ledgerState.refreshed = true;
  ledgerState.refreshes = 0;
});

afterEach(() => cleanup());

describe("OrdersPage — the top-N lever", () => {
  it("has more exception rows than the limit, or nothing below proves anything", () => {
    expect(EXCEPTION_ROWS).toBeGreaterThan(10);
  });

  it("truncates to ten for ?top=10 and tints the control", () => {
    renderAt(`${BEAT_VIEW}&top=10`);
    expect(rowCount()).toBe(10);
    expect(topTenActive()).toBe(true);
  });

  it.each(["abc", "0", "-3", "", "2.5", "10px"])(
    "ignores ?top=%s entirely — full list, no limit, and NOT one row",
    (value) => {
      renderAt(`${BEAT_VIEW}&top=${value}`);
      // The regression rendered exactly ONE row for every one of these.
      expect(rowCount()).not.toBe(1);
      expect(rowCount()).toBe(EXCEPTION_ROWS);
      // ...and the limit controls stay untinted, so the screen says "no limit".
      expect(topTenActive()).toBe(false);
    },
  );

  it("renders the same view as if the lever were absent", () => {
    renderAt(BEAT_VIEW);
    const absent = rowCount();
    renderAt(`${BEAT_VIEW}&top=abc`);
    expect(rowCount()).toBe(absent);
  });
});

/**
 * BEAT 3c — the count caption, which is the ONE number the room is asked to read
 * as proof the maneuver landed.
 *
 * It printed `of ${data.orders.length}` — every order in the ledger — so the
 * beat's own lever set `?status=open&exception=any&top=10` read "Top 10 of 22"
 * while 13 rows actually matched. A denominator that ignores the filters says the
 * filters did nothing, which is the opposite of what the beat claims. So the
 * denominator must be the FILTERED, pre-truncation count, and it must come off
 * the same pipeline the rows do.
 */
describe("OrdersPage — the count caption's denominator", () => {
  const seeded = () => store.snapshot();

  /** The beat's own lever set: a status AND an exception filter, plus a limit. */
  const FILTERED_VIEW = "status=open&exception=any&sort=aging_desc&top=10";

  /** What that view admits before the limit, computed independently of the page. */
  const matchingRows = () =>
    seeded().orders.filter(
      (o) => o.status === "open" && o.exception !== "none",
    );

  it("has a seed where those filters exclude rows AND the limit truncates", () => {
    // Without both, neither assertion below can tell the two numbers apart.
    expect(matchingRows().length).toBeLessThan(seeded().orders.length);
    expect(matchingRows().length).toBeGreaterThan(10);
  });

  it("counts the rows the filters admit, not the whole book", () => {
    renderAt(FILTERED_VIEW);
    const matching = matchingRows().length;
    expect(rowCount()).toBe(10);
    expect(queueCaption()).toBe(`Top 10 of ${matching}`);
    // The regression printed the full ledger as the denominator.
    expect(queueCaption()).not.toBe(`Top 10 of ${seeded().orders.length}`);
  });

  it("counts the whole book when no filter excludes anything", () => {
    renderAt("top=10");
    expect(rowCount()).toBe(10);
    expect(queueCaption()).toBe(`Top 10 of ${seeded().orders.length}`);
  });

  it("numbers the rows it actually rendered when the limit exceeds the matches", () => {
    // `Math.min(top, …)` used to carry this; `visible` is already sliced, so its
    // own length has to.
    renderAt("status=fulfilled&top=10");
    const fulfilled = seeded().orders.filter((o) => o.status === "fulfilled");
    expect(fulfilled.length).toBeLessThan(10);
    expect(rowCount()).toBe(fulfilled.length);
    expect(queueCaption()).toBe(
      `Top ${fulfilled.length} of ${fulfilled.length}`,
    );
  });

  it("tells the agent the same denominator it prints on screen", () => {
    // ONE derivation, two consumers: if these ever disagree, the readable and
    // the caption have started filtering the ledger separately again.
    renderAt(FILTERED_VIEW);
    const described = readableValue();
    expect(described.matchingCount).toBe(matchingRows().length);
    expect(queueCaption()).toBe(
      `Top ${described.visibleCount} of ${described.matchingCount}`,
    );
    // ...and the book-wide figures stay book-wide, under a key that says so.
    expect(described.book.totalOrders).toBe(seeded().orders.length);
  });
});

/**
 * BEAT 3b — the readable must describe the screen it is on, exactly.
 *
 * Both lists it sends carried their OWN limit: `visible.slice(0, 25)` against a
 * queue that renders every visible row, and `notifications.slice(0, 5)` against a
 * panel that renders 6. The second one shipped: with six notifications on screen
 * the assistant narrated five. Off by one is the version of wrong that survives a
 * live demo unnoticed, and it falsifies the beat's only claim — that the agent
 * sees what the presenter sees. So these tests do not assert a count; they assert
 * the readable's list is IDENTICAL, element for element and in order, to what the
 * DOM rendered.
 */
describe("OrdersPage — the beat-3b readable matches the rendered panels", () => {
  /**
   * A ledger deliberately larger than either former cap: the seed's orders are
   * duplicated (44 rows > the old 25) and eight notifications are attached (> the
   * panel's 6). Without the surplus, both caps sit unexercised and the assertions
   * would pass against the bug.
   */
  function crowdedLedger(): CommerceStoreState {
    const seeded = store.snapshot();
    const orders = [
      ...seeded.orders,
      ...seeded.orders.map((order, index) => ({
        ...order,
        id: `${order.id}-copy`,
        // Kept clear of the seed's four-digit numbers so every row is distinct.
        number: `90${index}`,
      })),
    ];
    const notifications = orders.slice(0, 8).map((order, index) => ({
      id: `ntf-${index}`,
      orderId: order.id,
      template: "verification-required" as const,
      sentAt: new Date(2026, 0, index + 1).toISOString(),
      sentBy: "Nadia Okonjo",
    }));
    return { ...seeded, orders, notifications };
  }

  beforeEach(() => {
    ledgerOverride.value = crowdedLedger();
  });

  it("sends the queue rows the queue actually renders, in the order shown", () => {
    renderAt("");
    const onScreen = renderedOrderNumbers();
    // Guard: past the old 25-row cap, or the truncation is never exercised.
    expect(onScreen.length).toBeGreaterThan(25);
    expect(readableValue().rows.map((row) => row.number)).toEqual(onScreen);
    expect(readableValue().visibleCount).toBe(onScreen.length);
  });

  it("still matches the queue when a lever truncates it", () => {
    renderAt("exception=any&sort=aging_desc&top=10");
    const onScreen = renderedOrderNumbers();
    expect(onScreen).toHaveLength(10);
    expect(readableValue().rows.map((row) => row.number)).toEqual(onScreen);
  });

  it("sends the notification rows the log actually renders, in the order shown", () => {
    renderAt("");
    const onScreen = renderedNotificationOrders();
    // Guard: the ledger holds more than the panel shows, so the panel truncates.
    expect(ledgerOverride.value?.notifications.length).toBeGreaterThan(
      onScreen.length,
    );
    const described = readableValue().recentNotifications.map(
      (row) => row.order,
    );
    expect(described).toEqual(onScreen);
  });
});

/**
 * The queue's TWO write controls — hold, and clear-exception — under the four
 * things that actually happen to them: a double-click, a fetch that never
 * answers, one row's refusal followed by another row's success, and a write that
 * LANDS while the follow-up re-read does not.
 *
 * What they had instead: no in-flight guard, no `disabled`, no `try/catch`, and
 * ONE page-level notice slot shared by every row. So —
 *
 *  1. A double-clicked hold fired two PATCHes; the second came back 409 from
 *     `store.orderStatusBlocker` and painted `ILLEGAL_ORDER_TRANSITION` over a
 *     hold that had SUCCEEDED. On stage the presenter's only recourse is to press
 *     it again.
 *  2. A rejecting `fetch` escaped the click handler as an unhandled rejection:
 *     nothing on screen, and beat 5's first write silently gone.
 *  3. One slot for the whole page meant row B's success called `setNotice(null)`
 *     and ERASED the refusal row A had just printed — the same silent no-op,
 *     reached through the report instead of the request.
 *  4. A hold that landed while `refresh()` failed left the row reading `open`, so
 *     the hold button stayed armed and invited a second write against a status
 *     the store had already moved.
 *
 * The in-flight assertions use a fetch that does not resolve until the test says
 * so, which is what makes them deterministic: the question is only ever "while
 * write #1 is outstanding, did the second click reach the network".
 */
describe("OrdersPage — the queue's writes cannot fire twice, latch, or erase", () => {
  /** Two OPEN, flagged rows, so a write on one can be raced against the other. */
  const ROW_A: Order = {
    id: "ord-a",
    number: "8001",
    customerName: "Priya Raghavan",
    customerEmail: "priya@example.com",
    channel: "web",
    destination: "Lisbon, PT",
    placedAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    status: "open",
    exception: "oversell",
    lines: [{ productId: "bw-1", quantity: 2, unitPrice: 40 }],
    total: 80,
    notes: [],
  };
  const ROW_B: Order = {
    ...ROW_A,
    id: "ord-b",
    number: "8002",
    customerName: "Ines Duarte",
    placedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    exception: "fraud-review",
  };

  const twoOpenOrders = (): CommerceStoreState => ({
    products: [],
    floors: [],
    orders: [ROW_A, ROW_B],
    notifications: [],
    returns: [],
    promotions: [],
    waivers: [],
    plans: [],
    operators: [],
  });

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
    /** Answer a REPEAT of a write the way the order state machine does. */
    refuseRepeats: boolean;
    /** Refusals to serve, by order id — one row can be refused and not another. */
    refuseFor: Record<string, Refusal>;
    reject: boolean;
  } = { hold: false, refuseRepeats: false, refuseFor: {}, reject: false };

  const json = (status: number, message: string) =>
    ({
      ok: false,
      status,
      json: async () => ({ message }),
    }) as unknown as Response;

  /**
   * Decide the response AT REQUEST TIME, not at release time — same reason as
   * `returns.test.tsx`: both clicks of an unguarded double-click are outstanding
   * together, so computing repeat-ness at release time would refuse both and make
   * the bug invisible.
   */
  function decide(url: string): Response {
    const repeat = posted.filter((seen) => seen === url).length > 1;
    if (server.refuseRepeats && repeat)
      return json(
        409,
        "That order cannot move to that status from where it is.",
      );
    const refusal = Object.entries(server.refuseFor).find(([id]) =>
      url.endsWith(`/${id}`),
    );
    if (refusal) return json(refusal[1].status, refusal[1].message);
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response;
  }

  beforeEach(() => {
    ledgerOverride.value = twoOpenOrders();
    posted.length = 0;
    withheld.length = 0;
    server.hold = false;
    server.refuseRepeats = false;
    server.refuseFor = {};
    server.reject = false;
    // The guard reports a fetch that never completed through `console.error`.
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

  /** PATCHes sent against one order. */
  const callsFor = (id: string) =>
    posted.filter((url) => url.endsWith(`/${id}`)).length;

  const holdButton = (number: string) =>
    screen.getByLabelText(`Hold order ${number}`);
  const clearButton = (number: string) =>
    screen.getByLabelText(`Clear the exception on order ${number}`);
  const disabled = (element: HTMLElement) => element.hasAttribute("disabled");

  it("PATCHes ONCE for a double-clicked hold, and paints no refusal", async () => {
    server.hold = true;
    server.refuseRepeats = true;
    renderAt("");

    const button = holdButton("8001");
    fireEvent.click(button);
    // The second click lands while write #1 is still outstanding.
    fireEvent.click(button);
    expect(callsFor("ord-a")).toBe(1);

    await release();
    expect(callsFor("ord-a")).toBe(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("PATCHes ONCE for a double-clicked clear-exception", async () => {
    server.hold = true;
    server.refuseRepeats = true;
    renderAt("");

    const button = clearButton("8001");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(callsFor("ord-a")).toBe(1);

    await release();
    expect(callsFor("ord-a")).toBe(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("will not let the row's OTHER lever start while a hold is outstanding", async () => {
    server.hold = true;
    renderAt("");

    fireEvent.click(holdButton("8001"));
    await flush();

    // Both levers write the same record and report into the same slot, so the
    // guard is the ROW's, not the button's.
    expect(disabled(holdButton("8001"))).toBe(true);
    expect(disabled(clearButton("8001"))).toBe(true);
    fireEvent.click(clearButton("8001"));
    expect(callsFor("ord-a")).toBe(1);

    // ...and it is the row's rather than the page's: row B has its own notice
    // slot, so nothing it does can speak for row A.
    expect(disabled(holdButton("8002"))).toBe(false);

    await release();
    // The guard is released, so the row's OTHER write is available again. The
    // hold's own lever is NOT, and must not be: that write landed, and this
    // mocked ledger never re-reads, which is exactly the state a failed
    // `refresh()` leaves behind — see the stale-view case below.
    expect(disabled(clearButton("8001"))).toBe(false);
  });

  it("does not latch, and speaks, when the hold fetch never answers", async () => {
    server.reject = true;
    renderAt("");

    fireEvent.click(holdButton("8001"));
    await flush();

    // THE LATCH: no `finally` and no guard release, so the row's levers used to
    // stay dead for the rest of the demo.
    expect(disabled(holdButton("8001"))).toBe(false);
    // A write that vanished with the page silent is the same dead button as a
    // refusal nobody printed.
    expect(screen.getByRole("status").textContent).toMatch(
      /nothing came back/i,
    );
    expect(ledgerState.refreshes).toBe(0);
  });

  it("keeps one row's refusal on screen when ANOTHER row's write succeeds", async () => {
    server.refuseFor = {
      "ord-a": { status: 409, message: "That order cannot be held from here." },
    };
    renderAt("");

    fireEvent.click(holdButton("8001"));
    await flush();
    expect(
      screen.getByText("That order cannot be held from here."),
    ).toBeTruthy();

    // Row B lands. With one page-wide slot its `setNotice(null)` took row A's
    // refusal away, and the refused write ended up saying nothing at all.
    fireEvent.click(holdButton("8002"));
    await flush();

    expect(
      screen.getByText("That order cannot be held from here."),
    ).toBeTruthy();
  });

  it("reports a landed hold whose re-read failed as done-but-behind, and does not re-arm it", async () => {
    // The hold landed and only the ledger re-read failed, so the row still reads
    // `open` and its button is still on screen — this is not a theoretical
    // branch. The one thing it must not do is invite the write a second time.
    ledgerState.refreshed = false;
    renderAt("");

    fireEvent.click(holdButton("8001"));
    await flush();

    expect(ledgerState.refreshes).toBe(1);
    expect(screen.getByRole("status").textContent).toMatch(
      /could not be re-read/,
    );
    expect(disabled(holdButton("8001"))).toBe(true);
    fireEvent.click(holdButton("8001"));
    expect(callsFor("ord-a")).toBe(1);
    // The row's other lever is a DIFFERENT write and stays available.
    expect(disabled(clearButton("8001"))).toBe(false);
  });
});

describe("parseTopLever", () => {
  it("honours a positive integer", () => {
    expect(parseTopLever("10")).toBe(10);
    expect(parseTopLever("5")).toBe(5);
    expect(parseTopLever("1")).toBe(1);
    // Surrounding whitespace is a transport artifact, not a different value.
    expect(parseTopLever(" 7 ")).toBe(7);
  });

  it("ignores every value it cannot honour, rather than clamping it to 1", () => {
    for (const raw of [
      null,
      undefined,
      "",
      " ",
      "abc",
      "0",
      "-3",
      "2.5",
      "1e2",
      "+5",
      "10px",
      "NaN",
      "Infinity",
      // Too long to represent exactly; a limit nobody could have meant.
      "99999999999999999999",
    ]) {
      expect(parseTopLever(raw), `top=${String(raw)}`).toBeNull();
    }
  });
});
