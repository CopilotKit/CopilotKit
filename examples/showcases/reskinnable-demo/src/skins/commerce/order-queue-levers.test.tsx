import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { z } from "zod";
import {
  normalizeQueueLevers,
  queueLeverChips,
  queueLeverQuery,
} from "./order-queue-levers";
import {
  EXCEPTION_FILTERS,
  ORDER_SORTS,
  ORDER_STATUS_FILTERS,
  isOnException,
} from "./data/derive";
import * as store from "./data/store";
import type { CommerceStoreState, Operator, Order } from "./data/types";

/**
 * BEAT 3c — the lever set the agent may ask for, versus what the app actually
 * does with it.
 *
 * The beat's claim is that the assistant reached into the app's REAL controls,
 * and two things shipped that falsify it in front of the room:
 *
 *  1. `showOrderQueue` advertised `status: "cancelled"` while the skin's global
 *     ledger readable filtered cancelled orders OUT — so the one status only the
 *     agent could reach was the one it could not then describe, and once it HAD
 *     navigated, the page readable listed rows the ledger readable denied
 *     existed. Fixed by making the order book whole and saying "not queue work"
 *     with `isOnException` instead of by dropping the row.
 *
 *  2. The card's chips defaulted: the Sort chip's ternary ended in a bare
 *     `"oldest first"`, so an `args.sort` that had not streamed in yet asserted
 *     `aging_desc` on the agent's behalf; status, exception and top-N did the
 *     same via `?? "all"`. A chip now appears only for a lever that was really
 *     set, and it is drawn from the same normalized record the URL is built
 *     from.
 *
 * No `@testing-library/jest-dom` in this app, so assertions are plain DOM.
 */

// ── The mock surface `CommerceTools` needs ──────────────────────────────────
// Filled at render time, never while these factories are hoisted.
const pushed: string[] = [];
const readables: { description: string; value: string }[] = [];
const interrupts = new Map<string, ToolRegistration>();
const ledger: { value: CommerceStoreState | null } = { value: null };

/** Only the parts of a registration these tests exercise. */
interface ToolRegistration {
  name: string;
  parameters: z.ZodType<unknown>;
  render?: (props: {
    args?: Record<string, unknown>;
    respond?: (value: string) => Promise<unknown>;
    result?: unknown;
    toolCallId?: string;
  }) => ReactNode;
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => {
      pushed.push(href);
    },
  }),
  usePathname: () => "/commerce",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: (entry: { description: string; value: string }) => {
    readables.push(entry);
  },
  useComponent: () => {},
  useFrontendTool: () => {},
  useHumanInTheLoop: (registration: ToolRegistration) => {
    interrupts.set(registration.name, registration);
  },
}));

vi.mock("@/shell/skin-provider", () => ({
  useSkin: () => ({ id: "commerce" }),
}));

vi.mock("./data/ledger-context", async () => {
  const real = await import("./data/store");
  return {
    useCommerceLedger: () => ({
      data: ledger.value ?? real.snapshot(),
      refresh: async () => true,
      operator: real.operators()[0] satisfies Operator,
      setOperatorId: () => {},
    }),
  };
});

// Imported after the mocks so the module graph picks them up.
const { CommerceTools } = await import("./tools");

/**
 * The seed carries no cancelled order — `cancelled` is only reachable at runtime
 * — so one is manufactured the way `setOrderStatus` produces it: cancelled while
 * STILL CARRYING the exception it was cancelled with. That is the row every
 * queue view has to drop and every order-book view has to keep.
 */
function ledgerWithCancelledException(): {
  state: CommerceStoreState;
  cancelled: Order;
} {
  const base = store.snapshot();
  const victim = base.orders.find(isOnException);
  if (!victim) throw new Error("seed has no order on exception");
  const cancelled: Order = { ...victim, status: "cancelled" };
  return {
    state: {
      ...base,
      orders: base.orders.map((o) => (o.id === victim.id ? cancelled : o)),
    },
    cancelled,
  };
}

/** The skin's global ledger readable, parsed. */
function ledgerReadable(): {
  orders: { id: string; status: string; onException: boolean }[];
} {
  const entry = readables.find((r) =>
    r.description.includes("Bellwether commerce ledger"),
  );
  if (!entry) throw new Error("the global ledger readable was not registered");
  return JSON.parse(entry.value) as {
    orders: { id: string; status: string; onException: boolean }[];
  };
}

function queueTool(): ToolRegistration {
  const tool = interrupts.get("showOrderQueue");
  if (!tool) throw new Error("showOrderQueue was not registered");
  return tool;
}

/** The chip pills the card actually draws, in order. */
function renderedChips(args: Record<string, unknown> | undefined): string[] {
  const tool = queueTool();
  render(<>{tool.render?.({ args, toolCallId: "call-1" })}</>);
  return [...document.querySelectorAll("li")].map(
    (li) => li.textContent?.trim() ?? "",
  );
}

beforeEach(() => {
  store.reset();
  pushed.length = 0;
  readables.length = 0;
  interrupts.clear();
  ledger.value = null;
});

afterEach(() => {
  cleanup();
});

describe("the advertised lever set", () => {
  it("offers exactly the vocabularies the Orders page has controls for", () => {
    render(<CommerceTools />);
    const shape = (
      queueTool().parameters as unknown as {
        shape: Record<string, { options?: readonly string[] }>;
      }
    ).shape;

    expect(shape.status.options).toEqual([...ORDER_STATUS_FILTERS]);
    expect(shape.exception.options).toEqual([...EXCEPTION_FILTERS]);
    expect(shape.sort.options).toEqual([...ORDER_SORTS]);
  });

  it("refuses a top-N the Orders page would ignore", () => {
    render(<CommerceTools />);
    const parameters = queueTool().parameters;
    const base = { status: "all", exception: "any", sort: "aging_desc" };

    expect(
      parameters.safeParse({ ...base, top: 10, reason: "x" }).success,
    ).toBe(true);
    // 0, negative and fractional limits are what `parseTopLever` throws away, so
    // the schema must not offer them in the first place.
    for (const top of [0, -3, 2.5]) {
      expect(
        parameters.safeParse({ ...base, top, reason: "x" }).success,
        `top=${top}`,
      ).toBe(false);
    }
  });
});

describe("every advertised status is describable", () => {
  it("keeps cancelled orders in the ledger readable, flagged as not queue work", () => {
    const { state, cancelled } = ledgerWithCancelledException();
    ledger.value = state;

    render(<CommerceTools />);
    const rows = ledgerReadable().orders;

    const row = rows.find((r) => r.id === cancelled.id);
    expect(row).toBeDefined();
    expect(row?.status).toBe("cancelled");
    // Present, and correctly NOT counted as queue work.
    expect(row?.onException).toBe(false);
  });

  it("describes every row each status lever can put on screen", () => {
    const { state } = ledgerWithCancelledException();
    ledger.value = state;

    render(<CommerceTools />);
    const described = new Set(ledgerReadable().orders.map((r) => r.id));

    for (const lever of ORDER_STATUS_FILTERS) {
      // The Orders page's own status clause: "all", else an exact match.
      const onScreen = state.orders.filter(
        (o) => lever === "all" || o.status === lever,
      );
      expect(onScreen.length, `status=${lever} shows nothing`).toBeGreaterThan(
        0,
      );
      for (const order of onScreen) {
        expect(described.has(order.id), `status=${lever} → ${order.id}`).toBe(
          true,
        );
      }
    }
  });

  it("agrees with isOnException on which rows are queue work", () => {
    const { state } = ledgerWithCancelledException();
    ledger.value = state;

    render(<CommerceTools />);
    const rows = ledgerReadable().orders;

    for (const order of state.orders) {
      expect(rows.find((r) => r.id === order.id)?.onException, order.id).toBe(
        isOnException(order),
      );
    }
  });
});

describe("a chip asserts only what was set", () => {
  it("draws no chip strip at all while the arguments are still streaming", () => {
    render(<CommerceTools />);
    expect(renderedChips(undefined)).toEqual([]);
    // And says so in prose rather than promising a list that is not there.
    expect(
      screen.getByText(/I can open the Orders page for you\./),
    ).toBeTruthy();
  });

  it("omits the Sort chip when no sort was set", () => {
    render(<CommerceTools />);
    const chips = renderedChips({ status: "all", exception: "any" });

    expect(chips).toEqual(["Status · all", "Exception · any"]);
    expect(chips.some((c) => c.startsWith("Sort"))).toBe(false);
  });

  it("draws one chip per lever once they have all arrived", () => {
    render(<CommerceTools />);

    expect(
      renderedChips({
        status: "open",
        exception: "oversell",
        sort: "value_desc",
        top: 10,
      }),
    ).toEqual([
      "Status · open",
      "Exception · oversell",
      "Sort · largest value",
      "Show · top 10",
    ]);
  });

  it("opens exactly the view the chips promised", () => {
    render(<CommerceTools />);
    const args = { exception: "any", sort: "aging_desc", top: 10 };
    render(
      <>
        {queueTool().render?.({
          args,
          // A real `respond`, so the card's own "cannot settle" warning is not
          // what this test is measuring.
          respond: async () => undefined,
          toolCallId: "call-2",
        })}
      </>,
    );

    screen.getByRole("button", { name: "Open it" }).click();

    expect(pushed).toEqual(["/commerce?exception=any&sort=aging_desc&top=10"]);
  });
});

// ── The pure lever contract ────────────────────────────────────────────────

describe("normalizeQueueLevers", () => {
  it("keeps every value the page's own vocabularies contain", () => {
    for (const status of ORDER_STATUS_FILTERS) {
      expect(normalizeQueueLevers({ status }).status).toBe(status);
    }
    for (const exception of EXCEPTION_FILTERS) {
      expect(normalizeQueueLevers({ exception }).exception).toBe(exception);
    }
    for (const sort of ORDER_SORTS) {
      expect(normalizeQueueLevers({ sort }).sort).toBe(sort);
    }
  });

  it("reports an unset lever as null rather than as a default", () => {
    expect(normalizeQueueLevers(undefined)).toEqual({
      status: null,
      exception: null,
      sort: null,
      top: null,
    });
    expect(normalizeQueueLevers({ status: "open" })).toEqual({
      status: "open",
      exception: null,
      sort: null,
      top: null,
    });
  });

  it("drops a value outside the page's vocabulary", () => {
    const levers = normalizeQueueLevers({
      status: "archived",
      exception: "none",
      sort: "value_asc",
    });
    // `none` is deliberately absent from EXCEPTION_FILTERS — see its header.
    expect(levers).toEqual({
      status: null,
      exception: null,
      sort: null,
      top: null,
    });
  });

  it("drops a top-N the page would ignore", () => {
    expect(normalizeQueueLevers({ top: 10 }).top).toBe(10);
    for (const top of [0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeQueueLevers({ top }).top, `top=${top}`).toBeNull();
    }
  });
});

describe("queueLeverChips and queueLeverQuery agree", () => {
  it("never draws a chip for a lever the URL will not carry", () => {
    const cases: Parameters<typeof normalizeQueueLevers>[0][] = [
      undefined,
      {},
      { status: "open" },
      { sort: "aging_asc" },
      { top: 5 },
      { top: 2.5 },
      { status: "cancelled", exception: "all", sort: "value_desc", top: 3 },
      { status: "all", exception: "any", sort: "aging_desc", top: 10 },
      { status: "bogus", exception: "bogus", sort: "bogus" },
    ];

    for (const args of cases) {
      const levers = normalizeQueueLevers(args);
      const chips = queueLeverChips(levers);
      const query = new URLSearchParams(queueLeverQuery(levers));
      const label = JSON.stringify(args);

      // `all` is expressed by an ABSENT param, so a chip for it is expected
      // without a param; every other chip must have one, and vice versa.
      expect(
        chips.some((c) => c.startsWith("Status")),
        `status chip ${label}`,
      ).toBe(levers.status !== null);
      expect(query.has("status"), `status param ${label}`).toBe(
        levers.status !== null && levers.status !== "all",
      );
      expect(
        chips.some((c) => c.startsWith("Exception")),
        `exception chip ${label}`,
      ).toBe(levers.exception !== null);
      expect(query.has("exception"), `exception param ${label}`).toBe(
        levers.exception !== null && levers.exception !== "all",
      );
      expect(
        chips.some((c) => c.startsWith("Sort")),
        `sort chip ${label}`,
      ).toBe(levers.sort !== null);
      expect(query.has("sort"), `sort param ${label}`).toBe(
        levers.sort !== null,
      );
      expect(
        chips.some((c) => c.startsWith("Show")),
        `top chip ${label}`,
      ).toBe(levers.top !== null);
      expect(query.get("top"), `top param ${label}`).toBe(
        levers.top === null ? null : String(levers.top),
      );
    }
  });
});
