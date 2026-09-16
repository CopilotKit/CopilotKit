import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { CommerceStoreState, Operator } from "./data/types";
import { CommerceTools } from "./tools";
import { RecordingProvider } from "@/shell/teach";

/**
 * The write tools must REFUSE a blank record reference rather than mutate the
 * first row in the ledger.
 *
 * `findOrder` / `findProduct` / `findReturn` each end in a substring match, and
 * `"anything".includes("")` is true, so a blank needle used to resolve to
 * `rows[0]`. The model supplies these needles from conversation, so blank is
 * ordinary input — and `holdOrder`, `notifyCustomer` and `postOrderNote` are
 * WRITE paths. The wrong-record write then came back as a success receipt naming
 * a customer nobody had mentioned.
 *
 * The pure matching is covered in `data/find-record.test.ts`; this file pins the
 * consequence at the tool boundary — no fetch, and a refusal in the result.
 *
 * `rows[0]` in the fixture below is Priya Raghavan, so "did not fall through to
 * row 0" is assertable by name.
 */

const { LEDGER, OPERATOR, refresh, TOOLS } = vi.hoisted(() => {
  const operator: Operator = {
    id: "op-nadia",
    name: "Nadia Okonjo",
    role: "merch-lead",
    team: "Merchandising",
  };
  const ledger: CommerceStoreState = {
    products: [
      {
        id: "bw-1",
        sku: "BW-CDR-HDY",
        name: "Cedar Hoodie",
        category: "Knitwear",
        listPrice: 120,
        unitCost: 70,
        inventory: 400,
        trailing30Units: 90,
        status: "live",
        vendor: "Cedar Mills",
      },
      {
        id: "bw-2",
        sku: "BW-ALD-THR",
        name: "Alder Throw",
        category: "Home",
        listPrice: 90,
        unitCost: 40,
        inventory: 120,
        trailing30Units: 30,
        status: "live",
        vendor: "Alder Co",
      },
    ],
    floors: [],
    orders: [
      {
        id: "ord-first",
        number: "4412",
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
      },
      {
        id: "ord-held",
        number: "4463",
        customerName: "Dana Reyes",
        customerEmail: "dana@example.com",
        channel: "retail",
        destination: "Porto, PT",
        placedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
        status: "open",
        exception: "none",
        lines: [{ productId: "bw-2", quantity: 1, unitPrice: 90 }],
        total: 90,
        notes: [],
      },
    ],
    notifications: [],
    returns: [],
    promotions: [],
    waivers: [],
    plans: [],
    operators: [operator],
  };
  return {
    OPERATOR: operator,
    LEDGER: ledger,
    refresh: vi.fn(async () => true),
    /** Every tool `CommerceTools` registers, captured by the mocked hooks. */
    TOOLS: new Map<string, RegisteredTool>(),
  };
});

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
interface RegisteredTool {
  name: string;
  handler?: ToolHandler;
}

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: () => {},
  useComponent: () => {},
  useFrontendTool: (config: RegisteredTool) => TOOLS.set(config.name, config),
  useHumanInTheLoop: (config: RegisteredTool) => TOOLS.set(config.name, config),
}));

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
    data: LEDGER,
    refresh,
    operator: OPERATOR,
    setOperatorId: () => {},
  }),
}));

const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

function handlerFor(name: string): ToolHandler {
  const handler = TOOLS.get(name)?.handler;
  if (!handler) throw new Error(`"${name}" registered no handler`);
  return handler;
}

beforeEach(() => {
  TOOLS.clear();
  fetchMock.mockClear();
  refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  render(
    <RecordingProvider>
      <CommerceTools />
    </RecordingProvider>,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Blank in every shape a model actually emits. */
const BLANK = ["", "   ", "#"];

describe("holdOrder — a blank order reference", () => {
  it.each(BLANK)("refuses %j instead of holding row 0", async (order) => {
    const result = await handlerFor("holdOrder")({
      order,
      reason: "fraud-review",
    });
    expect(String(result)).toMatch(/^No order matches/);
    // The finding itself: nothing was written.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(result)).not.toContain("4412");
    expect(String(result)).not.toContain("Priya");
  });

  it("still holds the order it was actually given", async () => {
    const result = await handlerFor("holdOrder")({
      order: "4463",
      reason: "oversell",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/commerce/v1/orders/ord-held");
    expect(init.method).toBe("PATCH");
    expect(String(result)).toContain("4463");
  });
});

describe("notifyCustomer — a blank order reference", () => {
  it.each(BLANK)("refuses %j instead of messaging row 0", async (order) => {
    const result = await handlerFor("notifyCustomer")({
      order,
      template: "verification-required",
    });
    expect(String(result)).toMatch(/^No order matches/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(result)).not.toContain("Priya");
  });

  it("still messages the customer it was actually given", async () => {
    await handlerFor("notifyCustomer")({
      order: "Dana",
      template: "delay-apology",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/commerce/v1/orders/ord-held/notify");
  });
});

describe("postOrderNote — a blank order reference", () => {
  it.each(BLANK)("refuses %j instead of annotating row 0", async (order) => {
    const result = await handlerFor("postOrderNote")({
      order,
      text: "Held pending verification.",
    });
    expect(String(result)).toMatch(/^No order matches/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still annotates the order it was actually given", async () => {
    await handlerFor("postOrderNote")({ order: "#4463", text: "Looked at." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/commerce/v1/orders/ord-held/notes");
  });
});

describe("the read-only distractors", () => {
  it.each(BLANK)(
    "sendReviewRequest(%j) names no customer at all",
    async (order) => {
      const result = await handlerFor("sendReviewRequest")({ order });
      expect(String(result)).not.toContain("Priya");
      expect(String(result)).not.toContain("Dana");
    },
  );

  it.each(BLANK)(
    "openSupplierClaim(%j) names no product at all",
    async (product) => {
      const result = await handlerFor("openSupplierClaim")({
        product,
        detail: "Short-shipped.",
      });
      expect(String(result)).not.toContain("Cedar Hoodie");
      expect(String(result)).not.toContain("Alder Throw");
    },
  );

  it("still resolves a real product reference", async () => {
    const result = await handlerFor("openSupplierClaim")({
      product: "alder",
      detail: "Short-shipped.",
    });
    expect(String(result)).toContain("Alder Throw");
  });
});
