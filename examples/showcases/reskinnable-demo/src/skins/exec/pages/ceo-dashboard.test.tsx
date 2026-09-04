import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as store from "../data/store";
import { ExceptionFeedStrip, visibleExceptions } from "./ceo-dashboard";
import type { VisibleException } from "./ceo-dashboard";

/**
 * BEAT 3b's fixed exception strip, and specifically the color it paints a
 * breach.
 *
 * Every card `ExceptionFeedStrip` renders is, by construction, a breach —
 * `data/store.ts`'s `exceptions()` only ever includes points whose |variance|
 * exceeds their metric's threshold, in either direction (see `isBreach`,
 * `data/derive.ts`). It shipped colored by the SIGN of `variancePct` instead
 * (positive → `text-positive`, i.e. green), so an over-plan breach — a
 * department that spent well past its opex plan, say — rendered as good news
 * on this strip while the Metrics Explorer colors that identical number red
 * via its own `row.breaching` (`./metrics-explorer.tsx`). A breach is bad
 * regardless of sign, and the two screens must agree.
 *
 * next/link renders as a plain anchor so jsdom needs no router, mirroring
 * `src/skins/keel/components/playbook-card.test.tsx`.
 */
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

afterEach(() => cleanup());

const OVER_PLAN_BREACH: VisibleException = {
  metricId: "opex",
  label: "Opex",
  // `opex` is one of the two `byDepartment` metrics, so a department-level
  // exception is a shape the ledger can actually produce.
  department: "distribution",
  period: "2024-06",
  // Positive — actual came in ABOVE plan. For a cost metric this is bad, but
  // the point holds regardless of what the metric means: every entry here is
  // already a breach, so the color must say so.
  variancePct: 0.12,
  explained: false,
};

// `dsoDays` is company-wide only — it has no per-department series, so it can
// only ever breach at "all". Spreading the opex fixture's `distribution` onto
// it described a row the seed cannot emit.
const UNDER_PLAN_BREACH: VisibleException = {
  ...OVER_PLAN_BREACH,
  metricId: "dsoDays",
  label: "DSO",
  department: "all",
  variancePct: -0.2,
};

describe("ExceptionFeedStrip", () => {
  it("colors an over-plan (positive-variance) breach with the alert treatment, not the positive one", () => {
    render(
      <ExceptionFeedStrip
        exceptions={[OVER_PLAN_BREACH]}
        skinHref={(path) => `/exec${path ? `/${path}` : ""}`}
      />,
    );
    const value = screen.getByText("+12.0%");
    expect(value.className).toContain("text-negative");
    expect(value.className).not.toContain("text-positive");
  });

  it("also colors an under-plan (negative-variance) breach with the alert treatment", () => {
    render(
      <ExceptionFeedStrip
        exceptions={[UNDER_PLAN_BREACH]}
        skinHref={(path) => `/exec${path ? `/${path}` : ""}`}
      />,
    );
    const value = screen.getByText("-20.0%");
    expect(value.className).toContain("text-negative");
  });

  /**
   * THE DRILL-IN. Each card is a link into the Metrics Explorer with that
   * card's OWN levers pre-set — department, period, and the threshold filter —
   * and it goes through the injected `skinHref` so a `LOCK_SKIN=exec` deploy
   * resolves it too. A card that linked to a bare `metrics` would land the CEO
   * on an unfiltered 14-metric table with no trace of the row they clicked.
   */
  it("drills into the Metrics Explorer with the card's own department, period and threshold filter", () => {
    render(
      <ExceptionFeedStrip
        exceptions={[OVER_PLAN_BREACH, UNDER_PLAN_BREACH]}
        skinHref={(path) => `/base${path ? `/${path}` : ""}`}
      />,
    );

    const [opex, dso] = screen.getAllByRole("link");
    expect(opex.getAttribute("href")).toBe(
      "/base/metrics?department=distribution&period=2024-06&threshold=1",
    );
    expect(dso.getAttribute("href")).toBe(
      "/base/metrics?department=all&period=2024-06&threshold=1",
    );
  });
});

/**
 * WHAT THE STRIP IS ALLOWED TO OMIT — and it is not "the CFO's metrics".
 *
 * The CEO page renders TWO exception surfaces at once: this fixed strip, and
 * the seeded `exceptionList` block in the grid below it. The block is
 * audience-agnostic (block specs carry no audience — see
 * `../blocks/build-block-ops.ts`), so it lists every breach at the latest
 * period. The strip used to narrow to the CEO audience, and with all three
 * seeded breaches tagged `cfo` that narrowing emptied it completely: the same
 * page showed zero exceptions above and three below, and the page readable
 * told the agent `exceptions: []` while three sat visibly on screen.
 *
 * `store.ts`'s own publish gate agrees with the wider reading — an
 * `exceptionList` block makes its dashboard's gate consider EVERY metric
 * (`referencedMetrics`), which is why the CEO pack still refuses on `dsoDays`.
 * So the strip is the COMPANY's exception feed, exactly as the CFO page's own
 * doc comment says of it, and it must match the block beside it row for row.
 */
/** One exception's identity: the pair the strip and the block both key on. */
const exceptionKey = (e: { metricId: string; department: string }) =>
  `${e.metricId}/${e.department}`;

describe("visibleExceptions", () => {
  beforeEach(() => store.reset());

  it("lists exactly the exceptions the page's own exceptionList block lists", () => {
    const snapshot = store.snapshot();

    expect(new Set(visibleExceptions(snapshot).map(exceptionKey))).toEqual(
      new Set(snapshot.exceptions.map(exceptionKey)),
    );
    // And that is not vacuously true: the seed carries breaches.
    expect(visibleExceptions(snapshot).length).toBeGreaterThanOrEqual(3);
  });

  it("carries each breach's label, variance and explained flag through unchanged", () => {
    const snapshot = store.snapshot();
    const opex = visibleExceptions(snapshot).find((e) => e.metricId === "opex");
    const seeded = snapshot.exceptions.find((e) => e.metricId === "opex");

    expect(opex).toBeDefined();
    expect(opex?.label).toBe("Opex");
    expect(opex?.department).toBe("distribution");
    expect(opex?.variancePct).toBe(seeded?.variancePct);
    expect(opex?.explained).toBe(seeded?.explained);
  });

  /**
   * A def-less exception is dropped — the SAME rule the `ExceptionList`
   * renderer applies — because without a def there is no label to print and no
   * threshold it can be said to have breached.
   */
  it("drops an exception whose metric has no def on the ledger", () => {
    const snapshot = store.snapshot();
    const rows = visibleExceptions({
      exceptions: snapshot.exceptions,
      metricDefs: snapshot.metricDefs.filter((def) => def.id !== "opex"),
    });

    expect(rows.some((row) => row.metricId === "opex")).toBe(false);
    expect(rows.length).toBe(snapshot.exceptions.length - 1);
  });
});
