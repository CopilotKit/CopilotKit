/**
 * BEAT 3b — the readables must describe the screen they are on, EXACTLY.
 *
 * `../readables.test.tsx` guards OMISSION: that a route readable, four page
 * readables and the prompt clause exist at all. It reads source text, and source
 * text is all a grep can see. It cannot see the property the beat actually rests
 * on — that the rows in the readable ARE the rows the panel painted, in the
 * order it painted them.
 *
 * That property is what fails silently. Commerce shipped a readable slicing 5
 * notifications against a panel rendering 6, so with six on screen the assistant
 * narrated five. Off by one is the version of wrong that survives a live demo
 * unnoticed, and it falsifies the beat's only claim — that the agent sees what
 * the presenter sees. Every assertion below therefore compares the readable's
 * list against the DOM, element for element and in order; none asserts a count
 * against a count, because two counts can agree while the lists differ.
 *
 * WHY THIS LANDS NOW rather than with the levers. Task 11 adds four filter
 * levers and truncation to the Control Tower. The moment it does, a readable
 * that reports `shipments.length` beside a truncated board becomes the commerce
 * bug exactly — and every source-text assertion still passes. The guard has to
 * exist BEFORE the change it is meant to catch.
 *
 * The ledgers below are deliberately larger than the seed (30 shipments, 30
 * lanes, 30 SKUs, 30 decisions) so that any cap someone adds later — the 25-row
 * `.slice` that was in this task's own brief, say — is exercised rather than
 * sitting inert behind a 6-row fixture.
 *
 * No `@testing-library/jest-dom` in this app, so assertions are plain DOM.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type {
  Decision,
  ExceptionCode,
  InventoryRisk,
  Lane,
  Shipment,
} from "../data/types";

/** What the page most recently handed `useAgentContext`, raw. */
const readable = { value: "" };

/**
 * The Control Tower reads its four beat-3c levers off `useSearchParams`; drive
 * that deterministically. `useRouter` is only used by the page's own controls,
 * which nothing here clicks.
 */
const query = { value: "" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(query.value),
}));

// `useSkinHref(skin.id)` is the real thing (unlocked → "/logistics"); only the
// identity it needs is stubbed, since no SkinProvider is mounted here.
vi.mock("@/shell/skin-provider", () => ({
  useSkin: () => ({ id: "logistics" }),
}));

// The pages register readables; no shell provider is mounted in this tree, so
// record the value rather than dropping it. `useAgentContext` is the ONLY thing
// these four pages use from the runtime.
vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: ({ value }: { value: string }) => {
    readable.value = value;
  },
}));

// The pages read their collections from `useLogistics`, which fetches over REST
// and needs the planner-auth context. Mocking the hook itself keeps the test on
// the thing under examination — the page's readable-versus-panel identity — and
// off the transport.
const ledger = {
  shipments: [] as Shipment[],
  lanes: [] as Lane[],
  inventory: [] as InventoryRisk[],
  decisions: [] as Decision[],
};
vi.mock("../actions", () => ({
  useLogistics: () => ledger,
}));

import { ControlTowerPage } from "./control-tower";
import { LanesPage } from "./lanes";
import { InventoryPage } from "./inventory";
import { DecisionsPage } from "./decisions";

afterEach(() => {
  cleanup();
  readable.value = "";
  query.value = "";
});

/**
 * The readable the page just registered, parsed. Fails with the OMISSION
 * message rather than "Unexpected end of JSON input" when the page registered
 * nothing — the two failures have different fixes and should not look alike.
 */
const described = <T,>() => {
  expect(
    readable.value,
    "the page registered no readable at all (beat 3b, part 2)",
  ).not.toBe("");
  return JSON.parse(readable.value) as {
    page: string;
    matching?: number;
    visible: number;
    rows: T[];
  };
};

/** Every `<td>` at index `col` of the page's single table, in the order shown. */
const renderedColumn = (col: number) =>
  Array.from(document.querySelectorAll("tbody tr")).map(
    (tr) => tr.children[col]?.textContent?.trim() ?? "",
  );

/**
 * The same, but located by COLUMN HEADING rather than by a magic index. The
 * Control Tower's board grows a leading rank column whenever a sort lever is
 * active, so a fixed `0` would silently start reading ranks as references — a
 * test that then compares two lists of "1", "2", "3" and passes.
 */
const renderedColumnNamed = (heading: string) => {
  const col = Array.from(document.querySelectorAll("thead th")).findIndex(
    (th) => th.textContent?.trim() === heading,
  );
  expect(col, `no "${heading}" column is rendered`).toBeGreaterThanOrEqual(0);
  return renderedColumn(col);
};

/** The text of one class-matched element per rendered `<li>`, in order. */
const renderedListField = (selector: string) =>
  Array.from(document.querySelectorAll("ul > li")).map(
    (li) => li.querySelector(selector)?.textContent?.trim() ?? "",
  );

const ROWS = 30;

// ── Fixtures, all deliberately larger than the seed ─────────────────────────

const STATUSES: Shipment["status"][] = [
  "on_track",
  "at_risk",
  "delayed",
  "resolved",
];

/**
 * Every fixture shipment carries an exception, because the Control Tower's board
 * is the EXCEPTION queue and drops anything clean. A separate case below feeds
 * it a clean shipment and asserts the drop, rather than weakening `ROWS` here.
 */
const CODES: ExceptionCode[] = [
  "PORT_CONGESTION",
  "CUSTOMS_HOLD",
  "CARRIER_DELAY",
  "WEATHER",
];

const shipments = (): Shipment[] =>
  Array.from({ length: ROWS }, (_, i) => ({
    id: `shp-${i}`,
    reference: `PO-9${String(i).padStart(4, "0")}`,
    laneId: `lane-${i % 4}`,
    carrier: `Carrier ${i % 5}`,
    skuId: `sku-${i % 3}`,
    units: 100 + i,
    weightKg: 10 + i,
    // Values ascend so the board's value tiebreak has real work to do; without
    // distinct values the status sort alone would decide every comparison and
    // the ordering assertion would pass against a half-implemented comparator.
    valueUsd: 1000 * (i + 1),
    etaPlanned: "2026-08-10",
    etaCurrent: "2026-08-12",
    slaDate: "2026-08-11",
    status: STATUSES[i % STATUSES.length]!,
    exception: {
      code: CODES[i % CODES.length]!,
      detail: `Detail ${i}`,
      since: "2026-08-01",
    },
  }));

const lanes = (): Lane[] =>
  Array.from({ length: ROWS }, (_, i) => ({
    id: `lane-${i}`,
    origin: `Origin ${i}`,
    destination: `Dest ${i}`,
    mode: "ocean",
    transitDays: 10 + i,
    reliability: 0.5 + i / 100,
    costPerKg: 0.5 + i / 10,
    status: "healthy",
  }));

const inventory = (): InventoryRisk[] =>
  Array.from({ length: ROWS }, (_, i) => ({
    skuId: `sku-${i}`,
    name: `Part ${i}`,
    onHandUnits: 100 * i,
    dailyDemand: 10,
    safetyStockDays: 5,
    inboundShipmentIds: [],
    // Alternating risk with descending cover, so both halves of the list's
    // comparator (at-risk first, then tightest cover) are exercised.
    daysOfCover: ROWS - i,
    atRisk: i % 2 === 0,
  }));

const decisions = (): Decision[] =>
  Array.from({ length: ROWS }, (_, i) => ({
    id: `dec-${i}`,
    shipmentId: `shp-${i}`,
    kind: "expedite",
    costUsd: 100 * i,
    rationale: `Rationale ${i}`,
    decidedBy: "Rosa Delgado",
    role: "Planner",
    status: "committed",
    // Ascending timestamps, so "newest first" reverses the input and an
    // unordered readable cannot accidentally agree with the panel.
    createdAt: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
  }));

describe("logistics beat 3b — the readable matches the rendered panel", () => {
  it("Control Tower sends the board rows it renders, in the order shown", () => {
    ledger.shipments = shipments();
    ledger.lanes = lanes();
    render(<ControlTowerPage />);

    const onScreen = renderedColumnNamed("Reference");
    expect(onScreen).toHaveLength(ROWS);
    // The board orders worst-first, so the painted order must NOT be the input
    // order — otherwise this test would pass on a readable that ignored order.
    expect(onScreen).not.toEqual(ledger.shipments.map((s) => s.reference));

    const value = described<{ reference: string }>();
    expect(value.page).toBe("Control Tower");
    expect(value.rows.map((r) => r.reference)).toEqual(onScreen);
    expect(value.visible).toBe(onScreen.length);
    // With no `top` lever nothing is truncated, so the two lengths agree — the
    // baseline the truncated case below is measured against.
    expect(value.matching).toBe(onScreen.length);
  });

  it("Control Tower leaves a shipment with no exception off the board", () => {
    // The board is the EXCEPTION queue. A clean shipment must be absent from the
    // rows AND from the readable — a readable listing a row the board dropped is
    // the same lie as one dropping a row the board painted, and the whole-network
    // count is still reported under `book`.
    ledger.shipments = [
      ...shipments(),
      {
        ...shipments()[0]!,
        id: "shp-clean",
        reference: "PO-CLEAN",
        exception: undefined,
      },
    ];
    ledger.lanes = lanes();
    render(<ControlTowerPage />);

    const onScreen = renderedColumnNamed("Reference");
    expect(onScreen).toHaveLength(ROWS);
    expect(onScreen).not.toContain("PO-CLEAN");

    const value = described<{ reference: string }>();
    expect(value.rows.map((r) => r.reference)).toEqual(onScreen);
    const book = JSON.parse(readable.value) as {
      book: { totalShipments: number; totalExceptions: number };
    };
    expect(book.book.totalShipments).toBe(ROWS + 1);
    expect(book.book.totalExceptions).toBe(ROWS);
  });

  it("Control Tower under ?top=N sends the TRUNCATED row list, not the matching one", () => {
    // A `visible` count agreeing with a `matching` count proves nothing; the row
    // LIST is the evidence. This is the case beat 3c actually ships — the pill
    // asks for ten — and the fixtures are 30 rows precisely so the cap bites.
    ledger.shipments = shipments();
    ledger.lanes = lanes();
    query.value = "top=10";
    render(<ControlTowerPage />);

    const onScreen = renderedColumnNamed("Reference");
    expect(onScreen).toHaveLength(10);

    const value = described<{ reference: string }>();
    expect(value.matching).toBe(ROWS);
    expect(value.visible).toBe(10);
    expect(value.rows.map((r) => r.reference)).toEqual(onScreen);
    // …and specifically the FIRST ten of the full ordering, not ten arbitrary
    // rows that happen to number ten.
    cleanup();
    readable.value = "";
    query.value = "";
    render(<ControlTowerPage />);
    expect(onScreen).toEqual(renderedColumnNamed("Reference").slice(0, 10));
  });

  it("Control Tower under ?sort= renders the sorted order, and ranks it", () => {
    // The board used to re-sort whatever it was handed, which made every sort
    // lever a no-op the confirm card still named and the control still tinted.
    // Worst-first puts `delayed` before `resolved` regardless of value, so a
    // pure value_desc order is a DIFFERENT list — and the readable must follow
    // the screen, not the default.
    ledger.shipments = shipments();
    ledger.lanes = lanes();
    query.value = "sort=value_desc";
    render(<ControlTowerPage />);

    const onScreen = renderedColumnNamed("Reference");
    const byValue = [...ledger.shipments]
      .sort((a, b) => b.valueUsd - a.valueUsd)
      .map((s) => s.reference);
    expect(onScreen).toEqual(byValue);

    const value = described<{ reference: string }>();
    expect(value.rows.map((r) => r.reference)).toEqual(onScreen);
    // The rank column only exists under a sort, and it is column 0 — which is
    // why the reference lookup above goes by heading rather than by index.
    expect(renderedColumn(0)).toEqual(
      Array.from({ length: ROWS }, (_, i) => String(i + 1)),
    );
  });

  it("Control Tower sends the KPI tiles as the strip formats them, under `book`", () => {
    ledger.shipments = shipments();
    ledger.lanes = lanes();
    render(<ControlTowerPage />);

    // Scoped to the strip's grid: the page's `<h1>` carries the same
    // `text-2xl font-semibold` pair, and an unscoped selector picked it up as a
    // fifth "tile" — which this assertion caught, and is exactly the class of
    // near-miss the whole test exists for.
    const onScreen = Array.from(
      document.querySelectorAll("div.grid > div > div.text-2xl"),
    ).map((el) => el.textContent?.trim() ?? "");
    expect(onScreen).toHaveLength(4);
    described<unknown>(); // registered-at-all check, with the clearer message
    const value = JSON.parse(readable.value) as {
      book: { kpi_tiles: { label: string; value: string }[] };
    };
    // Nested under `book`, not flat: these four are whole-network figures the
    // levers do not narrow, and the strip is captioned that way on screen. Flat,
    // beside a filtered row list, they read as a description of the view.
    expect(value.book.kpi_tiles.map((t) => t.value)).toEqual(onScreen);
    // Specifically: a DISPLAY string, never the 0.6666… ratio behind it.
    expect(value.book.kpi_tiles[0]?.value).toMatch(/^\d+%$/);
  });

  it("Lanes sends the lane rows it renders, in the order shown", () => {
    ledger.lanes = lanes();
    render(<LanesPage />);

    const onScreen = renderedColumn(0); // the Lane column
    expect(onScreen).toHaveLength(ROWS);

    const value = described<{ lane: string }>();
    expect(value.page).toBe("Lanes");
    expect(value.rows.map((r) => r.lane)).toEqual(onScreen);
    expect(value.visible).toBe(onScreen.length);
  });

  it("Inventory sends the SKU cards it renders, in the order shown", () => {
    ledger.inventory = inventory();
    render(<InventoryPage />);

    const onScreen = renderedListField("div.font-medium.text-ink");
    expect(onScreen).toHaveLength(ROWS);
    expect(onScreen).not.toEqual(ledger.inventory.map((i) => i.name));

    const value = described<{ name: string }>();
    expect(value.page).toBe("Inventory at Risk");
    expect(value.rows.map((r) => r.name)).toEqual(onScreen);
    expect(value.visible).toBe(onScreen.length);
  });

  it("Decision Log sends the entries it renders, in the order shown", () => {
    ledger.decisions = decisions();
    render(<DecisionsPage />);

    const onScreen = renderedListField("span.font-medium.text-ink");
    expect(onScreen).toHaveLength(ROWS);
    // "Newest first" reverses the fixture; if the readable ignored order this
    // is the assertion that would catch it.
    expect(onScreen).not.toEqual(ledger.decisions.map((d) => d.shipmentId));

    const value = described<{ shipment: string }>();
    expect(value.page).toBe("Decision Log");
    expect(value.rows.map((r) => r.shipment)).toEqual(onScreen);
    expect(value.visible).toBe(onScreen.length);
  });

  it("Decision Log reports an empty screen as empty", () => {
    // The seeded demo opens with zero decisions, and the agent still holds every
    // shipment, lane and SKU globally. Reporting 0 is what stops it describing
    // the network when asked about this page.
    ledger.decisions = [];
    render(<DecisionsPage />);

    const value = described<unknown>();
    expect(value.visible).toBe(0);
    expect(value.rows).toEqual([]);
    expect(document.querySelectorAll("ul > li")).toHaveLength(0);
  });
});
