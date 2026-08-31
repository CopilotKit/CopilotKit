import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { CommerceStoreState, Operator, Order } from "./data/types";
import { isWriteFailureLine, narrateWrite, resetLandedWrites } from "./settle";

/**
 * A write handler must END IN A RESULT on every path — success, refusal, AND a
 * fetch that never completed.
 *
 * The bug this pins: all seven `useFrontendTool` write handlers checked
 * `!res.ok` and nothing else, so an offline browser or a dev server restarted
 * mid-call threw straight out of the handler. The agent then gets no result for
 * that step at all, which on beat 5 — a THREE-write chain against one order —
 * is the worst available shape of failure: one write visibly landed, the next
 * silently vanished, and nothing on screen or in the transcript says which.
 *
 * Covered at both boundaries, because either alone leaves the bug reachable:
 * the WRAPPER (`narrateWrite` must resolve, and must distinguish a write that
 * landed from one that did not) and the HANDLERS (a handler that skipped the
 * wrapper would pass every wrapper assertion below).
 *
 * No `@testing-library/jest-dom` in this app, so nothing here touches matchers.
 */

// ── The handler half. `CommerceTools` registers into CopilotKit and renders
// null, so the only way to reach a handler is to capture the registrations as
// they are made. Hoisted because `vi.mock` is lifted above the imports.
const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (args: never) => Promise<string>>(),
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: () => {},
  useComponent: () => {},
  useHumanInTheLoop: () => {},
  useFrontendTool: (config: {
    name: string;
    handler?: (args: never) => Promise<string>;
  }) => {
    if (config.handler) handlers.set(config.name, config.handler);
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/shell/skin-provider", () => ({
  useSkin: () => ({ id: "commerce" }),
}));

vi.mock("@/shell/skin-path", () => ({
  useSkinHref: () => (path?: string) => path ?? "/commerce",
}));

const ORDER: Order = {
  id: "ord-4463",
  number: "4463",
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
};

const OPERATOR: Operator = {
  id: "op-nadia",
  name: "Nadia Okonjo",
  role: "merch-lead",
  team: "Merchandising",
};

const LEDGER: CommerceStoreState = {
  products: [],
  floors: [],
  orders: [ORDER],
  notifications: [],
  returns: [],
  promotions: [],
  waivers: [],
  plans: [],
  operators: [OPERATOR],
};

vi.mock("./data/ledger-context", () => ({
  useCommerceLedger: () => ({
    data: LEDGER,
    refresh: async () => true,
    operator: OPERATOR,
    setOperatorId: () => {},
  }),
}));

// Only `useRecording` is stubbed; the rest of the shell teach module is passed
// through, so a component that renders `RecordingProvider` / `RecordingVignette`
// / `RecordingFeed` anywhere in this graph still gets the real one.
vi.mock("@/shell/teach", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shell/teach")>()),
  useRecording: () => ({
    isRecording: false,
    steps: [],
    beginRecording: () => {},
    endRecording: () => {},
    logStep: () => {},
    getDemonstratedCode: () => null,
  }),
}));

// Imported after the mocks so it binds the stubbed modules.
import { CommerceTools } from "./tools";

/** Mount the registrations and hand back one handler by tool name. */
function handler<A>(name: string): (args: A) => Promise<string> {
  render(<CommerceTools />);
  const found = handlers.get(name);
  if (typeof found !== "function") {
    throw new Error(`${name} did not register a handler`);
  }
  return found as unknown as (args: A) => Promise<string>;
}

const ok = () =>
  ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response;

const setFetch = (impl: (url: string) => Promise<Response>) => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => impl(String(input))),
  );
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  resetLandedWrites();
});

afterEach(() => {
  cleanup();
  handlers.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("write handlers under a REJECTED fetch", () => {
  it("holdOrder resolves with a narratable failure instead of throwing", async () => {
    setFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const holdOrder = handler<{ order: string; reason: string }>("holdOrder");

    // The assertion that matters: it RESOLVES. Before the fix this rejected, and
    // the agent received nothing at all for the step.
    const result = await holdOrder({ order: "4463", reason: "fraud-review" });

    expect(isWriteFailureLine(result)).toBe(true);
    expect(result).toContain("the hold on order 4463");
    expect(result).toContain("Failed to fetch");
    // Honest about what it does NOT know: a rejected fetch cannot tell whether
    // the server saw the request, so it must not claim the ledger is untouched.
    expect(result).toMatch(/not applied/i);
    expect(console.error).toHaveBeenCalled();
  });

  it("postOrderNote resolves with a narratable failure instead of throwing", async () => {
    setFetch(async () => {
      throw new Error("socket hang up");
    });
    const postOrderNote = handler<{ order: string; text: string }>(
      "postOrderNote",
    );

    const result = await postOrderNote({
      order: "4463",
      text: "Held for fraud review.",
    });

    expect(isWriteFailureLine(result)).toBe(true);
    expect(result).toContain("the note on order 4463");
    expect(result).toContain("socket hang up");
  });

  it("approveMarkdown resolves rather than throwing, so beat 6 still narrates", async () => {
    setFetch(async () => {
      throw new Error("Failed to fetch");
    });
    const approveMarkdown = handler<{ promotionId: string }>("approveMarkdown");

    const result = await approveMarkdown({ promotionId: "promo-cedar" });

    expect(isWriteFailureLine(result)).toBe(true);
    expect(result).toContain("the approval of promo-cedar");
  });
});

/**
 * THE REGRESSION THIS FIX IS FOR. Beat 5 puts the order on hold, posts the note,
 * then notifies the customer. A throw on the SECOND write left the ledger
 * half-mutated with no receipt saying so: the room sees the hold land and the
 * note simply disappear.
 */
describe("beat 5's three-write chain, failing mid-chain", () => {
  it("reports what already landed on the order when write #2 fails", async () => {
    let calls = 0;
    setFetch(async (url) => {
      calls += 1;
      if (url.includes("/notes")) throw new Error("Failed to fetch");
      return ok();
    });

    const holdOrder = handler<{ order: string; reason: string }>("holdOrder");
    const postOrderNote = handler<{ order: string; text: string }>(
      "postOrderNote",
    );

    const held = await holdOrder({ order: "4463", reason: "fraud-review" });
    expect(isWriteFailureLine(held)).toBe(false);
    expect(held).toContain("on hold");

    const noted = await postOrderNote({
      order: "4463",
      text: "Held for fraud review.",
    });

    expect(calls).toBe(2);
    // (a) it failed, narratably
    expect(isWriteFailureLine(noted)).toBe(true);
    // (b) and it says the hold DID land — "held the order, but could not post the
    //     note" is the sentence the presenter needs, and the honest one: nothing
    //     was rolled back.
    expect(noted).toContain("still stand");
    expect(noted).toContain("put on hold");
  });

  it("keeps the recital to the order it is about", async () => {
    setFetch(async (url) => {
      if (url.includes("/notes")) throw new Error("Failed to fetch");
      return ok();
    });
    const holdOrder = handler<{ order: string; reason: string }>("holdOrder");
    await holdOrder({ order: "4463", reason: "fraud-review" });

    // A different record's failure must not inherit order 4463's history.
    const failure = await narrateWrite(
      { action: "the approval of promo-cedar" },
      async () => {
        throw new Error("Failed to fetch");
      },
    );
    expect(failure).not.toContain("still stand");
  });
});

describe("narrateWrite", () => {
  it("passes a successful body's line through untouched", async () => {
    await expect(
      narrateWrite({ action: "the hold on order 4463" }, async (landed) => {
        landed("put on hold");
        return "Order 4463 is on hold — Fraud review.";
      }),
    ).resolves.toBe("Order 4463 is on hold — Fraud review.");
  });

  it("passes a refusal through and does NOT journal it as landed", async () => {
    const refusal = await narrateWrite(
      { action: "the hold on order 4463", subject: "ord-4463" },
      async () => "Could not hold the order (HTTP 500).",
    );
    expect(refusal).toBe("Could not hold the order (HTTP 500).");

    // Nothing landed, so a later failure on the same order has nothing to recite.
    const next = await narrateWrite(
      { action: "the note on order 4463", subject: "ord-4463" },
      async () => {
        throw new Error("Failed to fetch");
      },
    );
    expect(next).not.toContain("still stand");
  });

  it("does not report a failure for a write that landed before the throw", async () => {
    const line = await narrateWrite(
      { action: "the hold on order 4463", subject: "ord-4463" },
      async (landed) => {
        landed("put on hold");
        // e.g. the follow-up ledger re-read blowing up after the PATCH committed.
        throw new Error("ledger unreachable");
      },
    );
    // A "could not" line here would be a receipt AGAINST a write that really
    // happened, which is the mirror image of the bug above and just as dishonest.
    expect(isWriteFailureLine(line)).toBe(false);
    expect(line).toContain("did land");
    expect(line).toContain("ledger unreachable");
  });

  it("never lists a repeated step twice", async () => {
    const run = () =>
      narrateWrite(
        { action: "the hold on order 4463", subject: "ord-4463" },
        async (landed) => {
          landed("put on hold");
          return "Order 4463 is on hold.";
        },
      );
    await run();
    await run();

    const failure = await narrateWrite(
      { action: "the note on order 4463", subject: "ord-4463" },
      async () => {
        throw new Error("Failed to fetch");
      },
    );
    expect(failure.match(/put on hold/g)?.length).toBe(1);
  });

  it("never throws, whatever the body throws", async () => {
    await expect(
      narrateWrite({ action: "the plan" }, () =>
        Promise.reject("not an Error at all"),
      ),
    ).resolves.toContain("not an Error at all");
  });
});

describe("isWriteFailureLine", () => {
  it("recognises every way this skin says a write did not happen", () => {
    expect(isWriteFailureLine("REFUSED (BELOW_MARGIN_FLOOR): nope")).toBe(true);
    expect(
      isWriteFailureLine("Could not complete the note: Failed to fetch."),
    ).toBe(true);
    expect(isWriteFailureLine("Could not hold the order (HTTP 500).")).toBe(
      true,
    );
    expect(isWriteFailureLine('No order matches "9999".')).toBe(true);
  });

  it("does not read a success receipt as a failure", () => {
    expect(isWriteFailureLine("Order 4463 is on hold — Fraud review.")).toBe(
      false,
    );
    expect(
      isWriteFailureLine("Approved. Cedar Hoodie goes live at 30% off."),
    ).toBe(false);
    expect(isWriteFailureLine(undefined)).toBe(false);
  });
});
