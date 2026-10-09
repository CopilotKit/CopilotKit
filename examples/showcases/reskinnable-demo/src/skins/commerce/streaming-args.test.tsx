import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import * as store from "./data/store";
import type { Operator } from "./data/types";

/**
 * ARGUMENTS STREAM, AND EVERY RENDER RUNS THROUGHOUT.
 *
 * CopilotKit hands a render `partialJSONParse(toolCall.function.arguments)`
 * verbatim, which returns `{}` for the first frames of a call, so EVERY declared
 * argument is `undefined` on the way to its value — a `.optional()` in the schema
 * is not what makes that true, and a required field is not what makes it false.
 * There is also nowhere to report a bad argument back from a display component
 * (a render-only tool posts an empty tool result), so the render IS the
 * enforcement.
 *
 * Two DIFFERENT failure modes come out of that, and they are treated differently
 * here because a single guard fixes only one of them:
 *
 *  - it THROWS. `showOrderList` did `orderIds.map(…)` on an argument that had
 *    not arrived, i.e. a TypeError inside React render, on BEAT 1 — the beat the
 *    demo opens with. Unconditional: it happens on every call to that component.
 *
 *  - it LIES. `showProduct` flashed a red "Nothing in the range matches ''"
 *    before the needle arrived, and `showMarginSummary` drew beat 4's rose "why"
 *    band as an empty coloured bar while the `note` streamed. Both assert
 *    something on screen — a miss, a recalled preference — that nobody has
 *    established yet.
 *
 * The standard for the second mode is the one `order-queue-levers` already set
 * for the Sort chip: a value that has not arrived gets NO confident rendering.
 * And not silence either — the audience is watching generative UI appear, so an
 * absent argument draws a visible arriving card rather than nothing at all.
 *
 * The `?? []` half of the fix is banking's established pattern for exactly this
 * (`src/skins/banking/tools.tsx:793-794`, `showTable`'s `columns ?? []` /
 * `rows ?? []`).
 *
 * No `@testing-library/jest-dom` in this app, so assertions are plain DOM.
 */

/** Only the parts of a registration these tests exercise. */
interface ComponentRegistration {
  name: string;
  render: (props: Record<string, unknown>) => ReactNode;
}

const { components, handlers } = vi.hoisted(() => ({
  components: new Map<string, ComponentRegistration>(),
  handlers: new Map<string, (args: never) => Promise<string>>(),
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: () => {},
  useComponent: (registration: ComponentRegistration) => {
    components.set(registration.name, registration);
  },
  useFrontendTool: (config: {
    name: string;
    handler?: (args: never) => Promise<string>;
  }) => {
    if (config.handler) handlers.set(config.name, config.handler);
  },
  useHumanInTheLoop: () => {},
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/commerce",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/shell/skin-provider", () => ({
  useSkin: () => ({ id: "commerce" }),
}));

vi.mock("@/shell/skin-path", () => ({
  useSkinHref: () => (path?: string) => path ?? "/commerce",
}));

vi.mock("./data/ledger-context", async () => {
  const real = await import("./data/store");
  return {
    useCommerceLedger: () => ({
      data: real.snapshot(),
      refresh: async () => true,
      operator: real.operators()[0] satisfies Operator,
      setOperatorId: () => {},
    }),
  };
});

// Imported after the mocks so the module graph picks them up.
const { CommerceTools } = await import("./tools");

/** Render one registered display component exactly as a tool call would. */
function draw(name: string, args: Record<string, unknown>) {
  const registration = components.get(name);
  if (!registration) throw new Error(`${name} was not registered`);
  render(<>{registration.render(args)}</>);
  return document.body.textContent ?? "";
}

function handler<A>(name: string): (args: A) => Promise<string> {
  const found = handlers.get(name);
  if (typeof found !== "function") {
    throw new Error(`${name} did not register a handler`);
  }
  return found as (args: A) => Promise<string>;
}

beforeEach(() => {
  store.reset();
  components.clear();
  handlers.clear();
  render(<CommerceTools />);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("showOrderList while its arguments stream", () => {
  it("does not throw when no ids have arrived at all", () => {
    // `{}` is literally what `partialJSONParse` returns for the first frames.
    expect(() => draw("showOrderList", {})).not.toThrow();
  });

  it("shows an arriving card rather than claiming no order matched", () => {
    // The lie half of the same instance: `orderIds ?? []` alone makes the card
    // render its red "No matching orders." on every call before the first id
    // lands, which is a MISS asserted over an argument nobody has sent.
    const text = draw("showOrderList", {});
    expect(text).not.toContain("No matching orders");
    expect(text.length).toBeGreaterThan(0);
  });

  it("survives a half-streamed array holding a blank string", () => {
    // `{"orderIds": ["` parses to a one-element array whose element is "".
    expect(() => draw("showOrderList", { orderIds: [""] })).not.toThrow();
    expect(document.body.textContent).not.toContain("No matching orders");
  });

  it("survives an element that is not a string yet", () => {
    expect(() =>
      draw("showOrderList", { orderIds: [null, 4471] }),
    ).not.toThrow();
  });

  it("still says so when real ids arrived and matched nothing", () => {
    const text = draw("showOrderList", { orderIds: ["ord-nope"] });
    expect(text).toContain("No matching orders");
  });

  it("lists the orders once the ids are complete", () => {
    const text = draw("showOrderList", {
      orderIds: ["ord-4471", "#4409"],
      caption: "The two oldest",
    });
    expect(text).toContain("Dorian Vale");
    expect(text).toContain("The two oldest");
  });
});

describe("showProduct while its argument streams", () => {
  it("does not flash a miss before the needle has arrived", () => {
    const text = draw("showProduct", {});
    expect(text).not.toContain("Nothing in the range matches");
    expect(text.length).toBeGreaterThan(0);
  });

  it("does not flash a miss on a blank or whitespace needle", () => {
    expect(draw("showProduct", { product: "" })).not.toContain(
      "Nothing in the range matches",
    );
    cleanup();
    expect(draw("showProduct", { product: "  " })).not.toContain(
      "Nothing in the range matches",
    );
  });

  it("does not throw when the needle is not a string yet", () => {
    expect(() => draw("showProduct", { product: 41 })).not.toThrow();
  });

  it("resolves a partially streamed name through the substring match", () => {
    expect(draw("showProduct", { product: "Cedar" })).toContain("Cedar Hoodie");
  });

  it("still reports a genuine miss once a real needle arrived", () => {
    expect(draw("showProduct", { product: "Zeppelin" })).toContain(
      "Nothing in the range matches",
    );
  });

  it("renders the card once the name is complete", () => {
    expect(draw("showProduct", { product: "Cedar Hoodie" })).toContain(
      "Cedar Hoodie",
    );
  });
});

/** The rose "why" band — beat 4's visible proof that memory was recalled. */
const whyBand = () => document.querySelector(".bg-brand-violet\\/10");

describe("showMarginSummary while its arguments stream", () => {
  it("draws no empty rose band before the note has arrived", () => {
    draw("showMarginSummary", {});
    expect(whyBand()).toBeNull();
  });

  it("draws no rose band for a blank note", () => {
    draw("showMarginSummary", {
      byCategory: true,
      belowFloorFirst: true,
      asMarginPercent: true,
      note: "   ",
    });
    expect(whyBand()).toBeNull();
  });

  it("still renders the list itself while the flags stream", () => {
    // Not silence: the audience is watching the card appear, so an absent flag
    // draws the list in its plain shape rather than an empty card.
    draw("showMarginSummary", {});
    expect(document.querySelectorAll("ul li").length).toBeGreaterThan(0);
  });

  it("draws the band once the note is complete", () => {
    const text = draw("showMarginSummary", {
      byCategory: true,
      belowFloorFirst: true,
      asMarginPercent: true,
      note: "You read these by category, below-floor first.",
    });
    expect(whyBand()?.textContent).toContain("by category");
    expect(text).toContain("Harbor Parka");
  });
});

describe("showMarginLadder while its argument streams", () => {
  // Already guarded by `resolveCategoryScope` — pinned here so the sweep records
  // the negative rather than leaving it to be re-derived.
  it("draws the whole range for an absent category", () => {
    expect(() => draw("showMarginLadder", {})).not.toThrow();
    expect(document.querySelector("figure")).not.toBeNull();
  });

  it("draws the whole range for a prefix of a real category", () => {
    draw("showMarginLadder", { category: "Foot" });
    expect(document.querySelector("figure")).not.toBeNull();
  });
});

describe("receipts that formatted an absent response field", () => {
  const respondWith = (status: number, body: unknown) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: status < 400,
      status,
      json: async () => body,
    } as Response);
  };

  it("omits the discount clause when the approval body carries no percent", async () => {
    respondWith(200, { promotion: { name: "Cedar Hoodie autumn markdown" } });
    const line = await handler<{ promotionId: string }>("approveMarkdown")({
      promotionId: "promo-cedar",
    });
    // "goes live at % off" is a sentence with the number missing from it.
    expect(line).not.toMatch(/at\s*% off/);
    expect(line).toContain("Cedar Hoodie autumn markdown");
  });

  it("states the discount when the body does carry it", async () => {
    respondWith(200, {
      promotion: { name: "Cedar Hoodie autumn markdown", discountPercent: 30 },
    });
    const line = await handler<{ promotionId: string }>("approveMarkdown")({
      promotionId: "promo-cedar",
    });
    expect(line).toContain("at 30% off");
  });

  it("does not report an undefined waiver id", async () => {
    respondWith(200, {});
    const line = await handler<{
      promotionId: string;
      code: string;
      justification: string;
    }>("openMarginWaiver")({
      promotionId: "promo-cedar",
      code: "MW-SEASON-EXIT",
      justification: "End of season exit approved by merchandising.",
    });
    expect(line).not.toContain("undefined");
    expect(line.toLowerCase()).toContain("waiver");
  });

  it("reports the waiver id when the body carries one", async () => {
    // Beat 6's next step needs it, so the clause must survive the guard.
    respondWith(200, { id: "mw-7" });
    const line = await handler<{
      promotionId: string;
      code: string;
      justification: string;
    }>("openMarginWaiver")({
      promotionId: "promo-cedar",
      code: "MW-SEASON-EXIT",
      justification: "End of season exit approved by merchandising.",
    });
    expect(line).toContain("Waiver id mw-7.");
  });

  it("does not describe a waiver by an absent code when finalizing", async () => {
    respondWith(200, {});
    const line = await handler<{ waiverId: string }>("finalizeMarginWaiver")({
      waiverId: "mw-1",
    });
    // The `?? ""` left a gap where the code should have been: "Finalized the
    // margin waiver." with two spaces in it.
    expect(line).not.toMatch(/\s{2}/);
    expect(line).toContain("Finalized the margin waiver.");
  });

  it("names the code when finalizing does carry one", async () => {
    respondWith(200, { code: "MW-SEASON-EXIT" });
    const line = await handler<{ waiverId: string }>("finalizeMarginWaiver")({
      waiverId: "mw-1",
    });
    expect(line).toContain("Finalized the MW-SEASON-EXIT margin waiver.");
  });
});
