import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ExceptionFeedStrip } from "./ceo-dashboard";
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
  metricId: "opex" as VisibleException["metricId"],
  label: "Opex",
  department: "distribution",
  period: "2024-06",
  // Positive — actual came in ABOVE plan. For a cost metric this is bad, but
  // the point holds regardless of what the metric means: every entry here is
  // already a breach, so the color must say so.
  variancePct: 0.12,
  explained: false,
};

const UNDER_PLAN_BREACH: VisibleException = {
  ...OVER_PLAN_BREACH,
  metricId: "dsoDays" as VisibleException["metricId"],
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
});
