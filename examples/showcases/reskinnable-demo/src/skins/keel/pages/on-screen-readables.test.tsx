/**
 * BEAT 3b — the readables must describe the screen they are on, EXACTLY, and
 * BEAT 3c — the four levers must actually filter, order, truncate and TINT.
 *
 * A source grep can see that a readable exists. It cannot see the property the
 * beat actually rests on: that the rows in the readable ARE the rows the board
 * painted, in the order it painted them. That is the failure that survives a
 * live demo unnoticed — commerce shipped a readable slicing 5 notifications
 * against a panel rendering 6, so with six on screen the assistant narrated
 * five, fluently and wrongly. Every assertion below therefore compares the
 * readable's list against the DOM, element for element and in order. None
 * asserts a count against a count, because two counts can agree while the lists
 * differ.
 *
 * The fixture is deliberately LARGER than the nine-document seed (24 rows) so
 * that any cap someone adds later is exercised rather than sitting inert behind
 * a fixture too small to reach it.
 *
 * No `@testing-library/jest-dom` in this app, so assertions are plain DOM.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { KeelLedger, DocumentRecord } from "../data/types";
import type { KnowledgeSpace } from "../knowledge/types";

/** What the page most recently handed `useAgentContext`, raw. */
const readable = { value: "" };

/**
 * The Register reads its four beat-3c levers off `useSearchParams`. Drive that
 * deterministically. `useRouter` is only used by the page's own controls, which
 * nothing here clicks.
 */
const query = { value: "" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(query.value),
  useParams: () => ({ skin: "keel", rest: route.rest }),
}));

const route: { rest: string[] | undefined } = { rest: undefined };

// `useKeelHref` is the REAL builder (unlocked → "/keel/..."), because a
// hardcoded prefix sneaking back into a row link is exactly what the LOCK_SKIN
// contract forbids and a stubbed builder would hide. Only the anchor is
// stubbed, to keep the real router out of jsdom.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// The pages register readables. No shell provider is mounted in this tree, so
// record the value rather than dropping it. `useAgentContext` is the ONLY thing
// these pages use from the runtime.
vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: ({ value }: { value: string }) => {
    readable.value = value;
  },
}));

/**
 * The pages read the register off the ledger snapshot, which fetches over REST.
 * Mocking the hook keeps this test on the thing under examination — the
 * readable-versus-panel identity — and off the transport.
 */
const ledger: { data: KeelLedger } = {
  data: {
    documents: [],
    runs: [],
    playbooks: [],
    personas: [],
    variances: [],
    impactBriefs: [],
    // A FIXED instant, so `reviewDue` comparisons are deterministic. Every
    // fixture date below is anchored to it.
    asOf: "2026-08-12T00:00:00.000Z",
  },
};
vi.mock("../ledger-context", () => ({
  useKeelLedger: () => ({
    data: ledger.data,
    refresh: async () => true,
    ready: true,
  }),
}));

import { KnowledgePage } from "./knowledge";
import { DocumentPage } from "./document";

const NOW = Date.parse("2026-08-12T00:00:00.000Z");
const DAY = 86_400_000;
const day = (offset: number) =>
  new Date(NOW + offset * DAY).toISOString().slice(0, 10);

afterEach(() => {
  cleanup();
  readable.value = "";
  query.value = "";
  route.rest = undefined;
  ledger.data = { ...ledger.data, documents: [] };
});

/**
 * The readable the page just registered, parsed. Fails with the OMISSION
 * message rather than "Unexpected end of JSON input" when the page registered
 * nothing — the two failures have different fixes and should not look alike.
 */
const described = <T,>() => {
  expect(
    readable.value,
    "the page registered no readable at all (beat 3b)",
  ).not.toBe("");
  return JSON.parse(readable.value) as T;
};

/** Every `<td>` at index `col` of the page's single table, in the order shown. */
const renderedColumn = (col: number) =>
  Array.from(document.querySelectorAll("tbody tr")).map(
    (tr) => tr.children[col]?.textContent?.trim() ?? "",
  );

/**
 * The same, but located by COLUMN HEADING rather than by a magic index. The
 * board grows a leading rank column whenever a sort lever is active, so a fixed
 * `0` would silently start reading ranks as references — a test that then
 * compares two lists of "1", "2", "3" and passes.
 */
const renderedColumnNamed = (heading: string) => {
  const col = Array.from(document.querySelectorAll("thead th")).findIndex(
    (th) => th.textContent?.trim() === heading,
  );
  expect(col, `no "${heading}" column is rendered`).toBeGreaterThanOrEqual(0);
  return renderedColumn(col);
};

/** A control's class list, located by its accessible name. */
const control = (label: string): string => {
  const el = document.querySelector(`[aria-label="${label}"]`);
  expect(el, `no control labelled "${label}" is rendered`).toBeTruthy();
  return el?.className ?? "";
};

/** The tint a lever set from the URL carries. */
const TINT = "bg-brand-soft";

const SPACES: KnowledgeSpace[] = ["privacy", "clinical", "vendor"];
const ROWS = 24;

/**
 * Twenty-four register rows, arranged so every lever value leaves several — a
 * one-row board is indistinguishable on stage from a broken filter, and a
 * fixture that produces one would let a broken filter pass here too.
 *
 *  - `space` cycles 8/8/8.
 *  - Every third row is past its review date (8 rows).
 *  - Coverage descends, so `coverage_asc` has real work to do, and every fourth
 *    row is under the 90% target (`attestation_short`).
 *  - Every sixth row carries an unendorsed pending revision (4 rows).
 *  - One row has nobody assigned, so the UNKNOWN coverage case is exercised
 *    rather than theoretical.
 */
const documents = (): DocumentRecord[] =>
  Array.from({ length: ROWS }, (_, i) => {
    const overdue = i % 3 === 0;
    const unassigned = i === 5;
    const assigned = unassigned ? 0 : 100;
    return {
      docId: `doc-${String(i).padStart(2, "0")}`,
      // Descending refs, so the register's input order is NOT `ref_asc` order
      // and a sort lever that did nothing could not accidentally agree.
      ref: `POL-${String(500 - i).padStart(3, "0")}`,
      title: `Document ${i}`,
      space: SPACES[i % 3]!,
      owner: `Owner ${i % 4}`,
      status: i % 5 === 0 ? "in_review" : "published",
      effectiveRevision: `Rev ${String.fromCharCode(65 + (i % 6))}`,
      lastReviewed: day(-200 - i),
      reviewDue: overdue ? day(-10 - i) : day(30 + i),
      attestation: {
        assigned,
        completed: unassigned ? 0 : 100 - (i % 4) * 6,
      },
      pendingRevision:
        i % 6 === 0
          ? {
              label: "Rev Z",
              stage: "draft" as const,
              summary: `Pending change ${i}`,
              authoredBy: "Policy Office",
              requiredEndorsements: [{ body: "Policy Governance Committee" }],
            }
          : undefined,
    };
  });

interface RegisterReadable {
  page: string;
  filters: {
    space: string | null;
    attention: string | null;
    sort: string | null;
    top: number | null;
  };
  book: {
    kpi_tiles: { label: string; value: string }[];
    totalDocuments: number;
  };
  matching: number;
  visible: number;
  rows: {
    ref: string;
    attestation_coverage_percent: number | null;
    attention: string[];
  }[];
}

describe("keel beat 3b — the Register readable matches the rendered board", () => {
  it("sends the rows it renders, in the order shown", () => {
    ledger.data = { ...ledger.data, documents: documents() };
    render(<KnowledgePage />);

    const onScreen = renderedColumnNamed("Reference");
    expect(onScreen).toHaveLength(ROWS);

    const value = described<RegisterReadable>();
    expect(value.page).toBe("Policy Register");
    expect(value.rows.map((r) => r.ref)).toEqual(onScreen);
    expect(value.visible).toBe(onScreen.length);
    // With no `top` lever nothing is truncated, so the two lengths agree — the
    // baseline the truncated case below is measured against.
    expect(value.matching).toBe(onScreen.length);
    expect(value.book.totalDocuments).toBe(ROWS);
  });

  it("reports unmeasurable attestation coverage as null, never 0", () => {
    // A document nobody is assigned to attest has UNKNOWN coverage. A model
    // cannot discount what you omitted and will restate a `0` as an all-clear,
    // out loud — so this is the one figure the readable must decline to state.
    ledger.data = { ...ledger.data, documents: documents() };
    render(<KnowledgePage />);

    const value = described<RegisterReadable>();
    const unknown = value.rows.find((r) => r.ref === "POL-495");
    expect(unknown?.attestation_coverage_percent).toBeNull();
    // …and the board says so in words rather than painting a zero.
    expect(document.body.textContent).toContain("Not measured");
    expect(value.rows.every((r) => r.attestation_coverage_percent !== 0)).toBe(
      true,
    );
  });

  it("sends the KPI tiles as the strip formats them, under `book`", () => {
    ledger.data = { ...ledger.data, documents: documents() };
    render(<KnowledgePage />);

    // Scoped to the strip's grid: the page's `<h1>` carries `text-2xl` too, and
    // an unscoped selector picks it up as a fifth "tile".
    const onScreen = Array.from(
      document.querySelectorAll("div.grid > div > div.text-2xl"),
    ).map((el) => el.textContent?.trim() ?? "");
    expect(onScreen).toHaveLength(4);

    const value = described<RegisterReadable>();
    expect(value.book.kpi_tiles.map((t) => t.value)).toEqual(onScreen);
    // Specifically a DISPLAY string, never the ratio behind it.
    expect(value.book.kpi_tiles[2]?.value).toMatch(/^\d+%$/);
  });

  it("reports an empty register as empty", () => {
    ledger.data = { ...ledger.data, documents: [] };
    render(<KnowledgePage />);

    const value = described<RegisterReadable>();
    expect(value.visible).toBe(0);
    expect(value.matching).toBe(0);
    expect(value.rows).toEqual([]);
    expect(document.querySelectorAll("tbody tr td[colspan]")).toHaveLength(1);
  });
});

describe("keel beat 3c — four levers, from the query string, all tinting", () => {
  it("?space= filters the board and tints ONLY the space control", () => {
    ledger.data = { ...ledger.data, documents: documents() };
    query.value = "space=privacy";
    render(<KnowledgePage />);

    const onScreen = renderedColumnNamed("Reference");
    // 8 of 24 — several rows, not one. A single-row result is indistinguishable
    // on stage from a broken filter.
    expect(onScreen).toHaveLength(8);

    const value = described<RegisterReadable>();
    expect(value.filters.space).toBe("privacy");
    expect(value.rows.map((r) => r.ref)).toEqual(onScreen);
    expect(value.matching).toBe(8);

    expect(control("Knowledge space")).toContain(TINT);
    expect(control("Attention class")).not.toContain(TINT);
    expect(control("Sort order")).not.toContain(TINT);
    expect(control("Row limit")).not.toContain(TINT);
  });

  it("?attention= selects the worklist it names, and leaves several rows", () => {
    ledger.data = { ...ledger.data, documents: documents() };
    query.value = "attention=unendorsed_revision";
    render(<KnowledgePage />);

    const onScreen = renderedColumnNamed("Reference");
    expect(onScreen).toHaveLength(4);

    const value = described<RegisterReadable>();
    expect(value.filters.attention).toBe("unendorsed_revision");
    expect(value.rows.map((r) => r.ref)).toEqual(onScreen);
    // Every row on screen genuinely carries the class the lever selected.
    expect(
      value.rows.every((r) => r.attention.includes("unendorsed_revision")),
    ).toBe(true);
    expect(control("Attention class")).toContain(TINT);
  });

  it("?sort= reorders the board, and ranks it", () => {
    ledger.data = { ...ledger.data, documents: documents() };
    query.value = "sort=ref_asc";
    render(<KnowledgePage />);

    const onScreen = renderedColumnNamed("Reference");
    const ascending = [...ledger.data.documents]
      .map((d) => d.ref)
      .sort((a, b) => a.localeCompare(b));
    expect(onScreen).toEqual(ascending);
    // The fixture's input order is DESCENDING, so a sort that did nothing would
    // fail here rather than accidentally agreeing.
    expect(onScreen).not.toEqual(ledger.data.documents.map((d) => d.ref));

    const value = described<RegisterReadable>();
    expect(value.rows.map((r) => r.ref)).toEqual(onScreen);

    // The rank column exists only under a sort, and it is column 0 — which is
    // why the reference lookup above goes by heading rather than by index.
    expect(renderedColumn(0)).toEqual(
      Array.from({ length: ROWS }, (_, i) => String(i + 1)),
    );
    expect(control("Sort order")).toContain(TINT);
  });

  it("?top=N sends the TRUNCATED row list, not the matching one", () => {
    // A `visible` count agreeing with a `matching` count proves nothing — the
    // row LIST is the evidence.
    ledger.data = { ...ledger.data, documents: documents() };
    query.value = "top=6";
    render(<KnowledgePage />);

    const onScreen = renderedColumnNamed("Reference");
    expect(onScreen).toHaveLength(6);

    const value = described<RegisterReadable>();
    expect(value.matching).toBe(ROWS);
    expect(value.visible).toBe(6);
    expect(value.rows.map((r) => r.ref)).toEqual(onScreen);
    expect(control("Row limit")).toContain(TINT);

    // …and specifically the FIRST six of the full ordering, not six arbitrary
    // rows that happen to number six.
    cleanup();
    readable.value = "";
    query.value = "";
    render(<KnowledgePage />);
    expect(onScreen).toEqual(renderedColumnNamed("Reference").slice(0, 6));
  });

  it("all four levers together leave a REAL board, and tint all four controls", () => {
    // The maneuver the demo actually performs. A four-lever pull that empties
    // the board is the beat failing while looking like it worked, so the count
    // is asserted as a range with a floor above one.
    ledger.data = { ...ledger.data, documents: documents() };
    query.value =
      "space=privacy&attention=review_overdue&sort=review_due_asc&top=3";
    render(<KnowledgePage />);

    const onScreen = renderedColumnNamed("Reference");
    expect(onScreen.length).toBeGreaterThan(1);
    expect(onScreen).toHaveLength(3);

    const value = described<RegisterReadable>();
    expect(value.filters).toEqual({
      space: "privacy",
      attention: "review_overdue",
      sort: "review_due_asc",
      top: 3,
    });
    expect(value.rows.map((r) => r.ref)).toEqual(onScreen);
    // `matching` is the pre-truncation count and must exceed `visible`, or the
    // "Top 3 of N" caption is reporting the filters did nothing.
    expect(value.matching).toBeGreaterThan(value.visible);

    expect(control("Knowledge space")).toContain(TINT);
    expect(control("Attention class")).toContain(TINT);
    expect(control("Sort order")).toContain(TINT);
    expect(control("Row limit")).toContain(TINT);

    // The caption's numerator and denominator BOTH come off the one pipeline.
    expect(document.body.textContent).toContain(
      `Top ${value.visible} of ${value.matching} matching documents`,
    );
  });

  it("an unrecognised lever value filters nothing and tints nothing", () => {
    // `?sort=by_vibes` normalizes to null, so the view renders exactly as it
    // does with the lever absent. A control tinted for a filter the page is not
    // applying is the confirm card lying with extra steps.
    ledger.data = { ...ledger.data, documents: documents() };
    query.value = "space=banana&sort=by_vibes&top=-3";
    render(<KnowledgePage />);

    expect(renderedColumnNamed("Reference")).toHaveLength(ROWS);
    const value = described<RegisterReadable>();
    expect(value.filters).toEqual({
      space: null,
      attention: null,
      sort: null,
      top: null,
    });
    expect(control("Knowledge space")).not.toContain(TINT);
    expect(control("Sort order")).not.toContain(TINT);
    expect(control("Row limit")).not.toContain(TINT);
    // No rank column without a real sort.
    expect(renderedColumnNamed("Reference")).toEqual(renderedColumn(0));
  });
});

interface DocumentReadable {
  page: string;
  doc_id: string | null;
  found: boolean;
  ref: string | null;
  sections: { id: string; heading: string }[];
  register: {
    review_due: string;
    attestation_coverage_percent: number | null;
    pending_revision: { label: string } | null;
  } | null;
}

describe("keel beat 3b — the open document answers DIFFERENTLY from the Register", () => {
  it("describes the open document, its sections in order, and its register row", () => {
    ledger.data = {
      ...ledger.data,
      documents: [
        {
          docId: "phi-access-policy",
          ref: "POL-114",
          title: "PHI Access & Minimum Necessary",
          space: "privacy",
          owner: "Privacy Office",
          status: "in_review",
          effectiveRevision: "Rev C",
          lastReviewed: day(-400),
          reviewDue: day(-35),
          attestation: { assigned: 1240, completed: 1102 },
          pendingRevision: {
            label: "Rev D",
            stage: "draft",
            summary: "Adds a contractor recertification.",
            authoredBy: "Privacy Office",
            requiredEndorsements: [{ body: "Policy Governance Committee" }],
          },
        },
      ],
    };
    route.rest = ["knowledge", "phi-access-policy"];
    render(<DocumentPage />);

    const value = described<DocumentReadable>();
    expect(value.page).toBe("Policy document");
    expect(value.found).toBe(true);
    expect(value.ref).toBe("POL-114");
    expect(value.doc_id).toBe("phi-access-policy");

    // The sections listed ARE the sections the reader painted, in order.
    const onScreen = Array.from(
      document.querySelectorAll("article > section[id]"),
    ).map((el) => el.id);
    expect(onScreen.length).toBeGreaterThan(1);
    expect(value.sections.map((s) => s.id)).toEqual(onScreen);

    // The register overlay, which the Register page's readable does NOT carry
    // per-document. This is what makes the second ask a different answer.
    expect(value.register?.pending_revision?.label).toBe("Rev D");
    expect(value.register?.attestation_coverage_percent).toBe(89);
    expect(document.body.textContent).toContain("Rev D awaiting release");
    expect(document.body.textContent).toContain(
      "Not yet endorsed by Policy Governance Committee",
    );
  });

  it("renders the prose with no register strip when the register has no row", () => {
    // A corpus document with no overlay is not an error — the prose is the
    // primary artifact and the lifecycle is additive.
    ledger.data = { ...ledger.data, documents: [] };
    route.rest = ["knowledge", "phi-access-policy"];
    render(<DocumentPage />);

    const value = described<DocumentReadable>();
    expect(value.found).toBe(true);
    expect(value.register).toBeNull();
    expect(document.querySelector('[aria-label="Register status"]')).toBeNull();
    expect(
      document.querySelectorAll("article > section[id]").length,
    ).toBeGreaterThan(1);
  });

  it("still describes the screen when the docId is unknown", () => {
    // "The operator is looking at a document the library does not carry" is
    // itself worth describing — an agent that answers "I cannot see the screen"
    // here has lost the beat on the one page where it matters most.
    route.rest = ["knowledge", "does-not-exist"];
    render(<DocumentPage />);

    const value = described<DocumentReadable>();
    expect(value.found).toBe(false);
    expect(value.doc_id).toBe("does-not-exist");
    expect(value.sections).toEqual([]);
    expect(document.body.textContent).toContain("Document not found");
  });
});
