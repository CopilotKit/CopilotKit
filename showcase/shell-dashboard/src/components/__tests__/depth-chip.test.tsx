/**
 * Unit tests for DepthChip — renders correct text + class for D0-D6,
 * unshipped, unsupported, regression, and relative-to-maxDepth color logic.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DepthChip, depthColorClass, chipColorToClass } from "../depth-chip";

describe("DepthChip", () => {
  it.each([0, 1, 2, 3, 4, 5, 6])(
    "renders D%i for depth=%i with wired status",
    (depth) => {
      const { getByTestId } = render(
        <DepthChip depth={depth as 0 | 1 | 2 | 3 | 4 | 5 | 6} status="wired" />,
      );
      const chip = getByTestId("depth-chip");
      expect(chip.textContent).toBe(`D${depth}`);
    },
  );

  // ── D0 is always gray regardless of maxDepth ──

  it("renders D0 with gray background class", () => {
    const { getByTestId } = render(<DepthChip depth={0} status="wired" />);
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("text-muted");
  });

  it("renders D0 with gray even when maxDepth=0", () => {
    const { getByTestId } = render(
      <DepthChip depth={0} status="wired" maxDepth={0} />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("text-muted");
  });

  // ── Relative color: depth >= maxDepth = green ──

  it("renders D4 green when maxDepth=4 (at ceiling)", () => {
    const { getByTestId } = render(
      <DepthChip depth={4} status="wired" maxDepth={4} />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("emerald");
  });

  it("renders D5 green when maxDepth=5 (at ceiling)", () => {
    const { getByTestId } = render(
      <DepthChip depth={5} status="wired" maxDepth={5} />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("emerald");
  });

  it("renders D6 green when maxDepth=6 (at ceiling)", () => {
    const { getByTestId } = render(
      <DepthChip depth={6} status="wired" maxDepth={6} />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("emerald");
  });

  // ── Relative color: 1-2 levels below maxDepth = amber ──

  it("renders D4 amber when maxDepth=5 (1 below ceiling)", () => {
    const { getByTestId } = render(
      <DepthChip depth={4} status="wired" maxDepth={5} />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("amber");
  });

  it("renders D3 amber when maxDepth=5 (2 below ceiling)", () => {
    const { getByTestId } = render(
      <DepthChip depth={3} status="wired" maxDepth={5} />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("amber");
  });

  it("renders D4 amber when maxDepth=6 (2 below ceiling)", () => {
    const { getByTestId } = render(
      <DepthChip depth={4} status="wired" maxDepth={6} />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("amber");
  });

  // ── Relative color: 3+ levels below maxDepth = red ──

  it("renders D1 red when maxDepth=5 (4 below ceiling)", () => {
    const { getByTestId } = render(
      <DepthChip depth={1} status="wired" maxDepth={5} />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("danger");
  });

  it("renders D2 red when maxDepth=5 (3 below ceiling)", () => {
    const { getByTestId } = render(
      <DepthChip depth={2} status="wired" maxDepth={5} />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("danger");
  });

  it("renders D1 red when maxDepth=6 (5 below ceiling)", () => {
    const { getByTestId } = render(
      <DepthChip depth={1} status="wired" maxDepth={6} />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("danger");
  });

  // ── Fallback: no maxDepth uses heuristic (D4+ green, D2-D3 amber, D1 red) ──

  it("renders D5 green when no maxDepth (fallback)", () => {
    const { getByTestId } = render(<DepthChip depth={5} status="wired" />);
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("emerald");
  });

  it("renders D4 green when no maxDepth (fallback)", () => {
    const { getByTestId } = render(<DepthChip depth={4} status="wired" />);
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("emerald");
  });

  it("renders D3 amber when no maxDepth (fallback)", () => {
    const { getByTestId } = render(<DepthChip depth={3} status="wired" />);
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("amber");
  });

  it("renders D2 amber when no maxDepth (fallback)", () => {
    const { getByTestId } = render(<DepthChip depth={2} status="wired" />);
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("amber");
  });

  it("renders D1 red when no maxDepth (fallback)", () => {
    const { getByTestId } = render(<DepthChip depth={1} status="wired" />);
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("danger");
  });

  // ── Unshipped / unsupported / stub / regression ──

  it("renders '--' for unshipped status with dashed border", () => {
    const { getByTestId } = render(<DepthChip depth={0} status="unshipped" />);
    const chip = getByTestId("depth-chip");
    expect(chip.textContent).toBe("--");
    expect(chip.className).toContain("border-dashed");
    expect(chip.getAttribute("data-status")).toBe("unshipped");
  });

  it("renders prohibited emoji for unsupported with descriptive tooltip", () => {
    const { getByTestId } = render(
      <DepthChip depth={0} status="unsupported" />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.textContent).toBe("\u{1F6AB}");
    // Distinct attribute lets the matrix and tests differentiate from unshipped.
    expect(chip.getAttribute("data-status")).toBe("unsupported");
    expect(chip.getAttribute("title")).toBe("Not supported by this framework");
  });

  it("unsupported renders distinctly from unshipped (different glyph + status)", () => {
    const { container: cU } = render(
      <DepthChip depth={0} status="unshipped" />,
    );
    const { container: cNS } = render(
      <DepthChip depth={0} status="unsupported" />,
    );
    const unshippedChip = cU.querySelector(
      "[data-testid='depth-chip']",
    ) as HTMLElement;
    const unsupportedChip = cNS.querySelector(
      "[data-testid='depth-chip']",
    ) as HTMLElement;
    expect(unshippedChip).toBeDefined();
    expect(unsupportedChip).toBeDefined();
    expect(unshippedChip.textContent).not.toBe(unsupportedChip.textContent);
    expect(unshippedChip.getAttribute("data-status")).not.toBe(
      unsupportedChip.getAttribute("data-status"),
    );
  });

  it("renders stub status same as wired (D0 gray)", () => {
    const { getByTestId } = render(<DepthChip depth={0} status="stub" />);
    const chip = getByTestId("depth-chip");
    expect(chip.textContent).toBe("D0");
  });

  it("renders regression with danger color regardless of depth or maxDepth", () => {
    const { getByTestId } = render(
      <DepthChip depth={5} status="wired" regression maxDepth={5} />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("danger");
  });

  // ── REQ-B: pool comm-error / unreachable treatment ──────────────────

  it("renders a DISTINCT unreachable treatment when unreachable=true", () => {
    const { getByTestId } = render(
      <DepthChip
        depth={5}
        status="wired"
        chipColor="green"
        unreachable
        commTooltip="pool unreachable: worker-unreachable — worker w-7"
      />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.getAttribute("data-status")).toBe("unreachable");
    expect(chip.getAttribute("data-surface-state")).toBe("unreachable");
    // Tooltip names the comm-error kind + worker.
    expect(chip.getAttribute("title")).toContain("worker-unreachable");
    expect(chip.getAttribute("title")).toContain("w-7");
    // Visually distinct from green/amber/red/gray — uses the indigo overlay,
    // NOT the emerald/danger/amber/text-muted probe-colour classes.
    expect(chip.className).toContain("indigo");
    expect(chip.className).not.toContain("emerald");
    expect(chip.className).not.toContain("danger");
  });

  it("unreachable overrides chipColor='red' (comm error ≠ red test)", () => {
    const { getByTestId } = render(
      <DepthChip depth={3} status="wired" chipColor="red" unreachable />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.getAttribute("data-status")).toBe("unreachable");
    // A comm error must never be painted as a red test.
    expect(chip.className).not.toContain("danger");
    expect(chip.className).toContain("indigo");
  });

  it("renders normally (no unreachable) when unreachable=false", () => {
    const { getByTestId } = render(
      <DepthChip
        depth={5}
        status="wired"
        chipColor="green"
        unreachable={false}
      />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.getAttribute("data-status")).not.toBe("unreachable");
    expect(chip.className).toContain("emerald");
  });

  // ── flap-band #70 / stale-while-revalidate: pending (reclaimed) ──────

  // STALE-WHILE-REVALIDATE: a pending re-run over a prior known-good GREEN cell
  // must KEEP its green colour and add a non-destructive refreshing affordance —
  // NOT flip to grey. This is the core green→grey→green flap fix.
  it("pending over a prior-good GREEN cell keeps GREEN + adds a refreshing affordance (no grey flap)", () => {
    const { getByTestId } = render(
      <DepthChip
        depth={6}
        status="wired"
        chipColor="green"
        pending
        commTooltip="re-queued (pending): worker-reclaimed-pending — worker w-9"
      />,
    );
    const chip = getByTestId("depth-chip");
    // Surface state hooks preserved for the matrix / e2e DOM inspection.
    expect(chip.getAttribute("data-status")).toBe("pending");
    expect(chip.getAttribute("data-surface-state")).toBe("pending");
    expect(chip.getAttribute("title")).toContain("worker-reclaimed-pending");
    // Colour PRESERVED — the green coverage chip is NOT replaced by grey.
    expect(chip.className).toContain("emerald");
    expect(chip.className).not.toContain("danger");
    expect(chip.className).not.toContain("indigo");
    // Must NOT use the destructive grey "no-data" fill.
    expect(chip.className).not.toContain("bg-[var(--text-muted)]/20");
    // Non-destructive refreshing affordance: a ⟳ glyph (shape, not colour) and
    // an explicit data hook for tests / e2e.
    expect(chip.getAttribute("data-refreshing")).toBe("true");
    expect(chip.getAttribute("data-has-prior")).toBe("true");
    expect(chip.textContent).toContain("⟳");
    // The depth label still reads (stale-but-valid), so D6 is still legible.
    expect(chip.textContent).toContain("D6");
  });

  // CONTRACT PIN (never-run / first load): no prior known-good result
  // (chipColor gray + depth 0) → keep today's honest grey ⟳ chip.
  it("pending with NO prior-good (gray + depth=0) still renders the grey ⟳ chip", () => {
    const { getByTestId } = render(
      <DepthChip depth={0} status="wired" chipColor="gray" pending />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.getAttribute("data-status")).toBe("pending");
    expect(chip.getAttribute("data-surface-state")).toBe("pending");
    expect(chip.getAttribute("data-refreshing")).toBe("true");
    expect(chip.getAttribute("data-has-prior")).toBe("false");
    // Honest no-data grey — nothing to preserve.
    expect(chip.className).toContain("text-muted");
    expect(chip.className).not.toContain("emerald");
    expect(chip.textContent).toContain("⟳");
  });

  // A11Y: an EXPLICIT gray chipColor means "no live probe data", so a grey
  // depth>0 chip is NOT genuinely prior-good — it must fall through to the
  // honest grey ⟳ chip (data-has-prior="false"), not claim a prior result.
  it("pending with gray chipColor + depth>0 is NOT prior-good (honest grey ⟳)", () => {
    const { getByTestId } = render(
      <DepthChip depth={3} status="wired" chipColor="gray" pending />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.getAttribute("data-has-prior")).toBe("false");
    expect(chip.getAttribute("data-refreshing")).toBe("true");
    expect(chip.className).toContain("text-muted");
    expect(chip.className).not.toContain("emerald");
    expect(chip.textContent).toContain("⟳");
  });

  // A11Y: the refreshing aria-label says "regression" ONLY for an actually-
  // flagged regression — a danger-COLOURED-but-not-flagged pending cell (deep
  // below ceiling) suppresses the spinner the same way but must not be
  // announced as a regression.
  it("pending danger-coloured (not flagged) chip does NOT say 'regression' in its label", () => {
    const { getByTestId } = render(
      // depth 1, maxDepth 6 → danger colour via depthColorClass, but
      // regression flag is NOT set.
      <DepthChip depth={1} status="wired" maxDepth={6} pending />,
    );
    const chip = getByTestId("depth-chip");
    // Failure colour ⇒ no spinner (colour passthrough), but the label must be
    // the neutral depth form, never "regression".
    expect(chip.className).toContain("danger");
    expect(chip.getAttribute("aria-label")).toBe("Depth 1");
    expect(chip.getAttribute("aria-label")).not.toContain("regression");
    expect(chip.getAttribute("data-refreshing")).not.toBe("true");
  });

  it("pending FLAGGED regression still announces 'regression' in its label", () => {
    const { getByTestId } = render(
      <DepthChip
        depth={5}
        status="wired"
        chipColor="green"
        regression
        pending
      />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.getAttribute("aria-label")).toBe("Depth 5 — regression");
  });

  // A pending re-run must NEVER read as a failure — no red, no indigo overlay,
  // regardless of whether there is a prior-good result.
  it("pending never reads as a failure (no danger, no indigo overlay)", () => {
    const { getByTestId } = render(
      <DepthChip depth={6} status="wired" chipColor="green" pending />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).not.toContain("danger");
    expect(chip.className).not.toContain("indigo");
  });

  // DECISION-TABLE GUARD ("failure → no spinner"): a regression-coloured cell
  // that is also pending must render the failure RED (colour passthrough) and
  // must NOT show the ⟳ refreshing spinner — a failure is not "re-running".
  it("regression + pending renders the failure red and NO ⟳ spinner / data-refreshing", () => {
    const { getByTestId } = render(
      <DepthChip
        depth={5}
        status="wired"
        chipColor="green"
        regression
        pending
      />,
    );
    const chip = getByTestId("depth-chip");
    // Failure colour wins (regression overrides green → danger red).
    expect(chip.className).toContain("danger");
    expect(chip.className).not.toContain("emerald");
    // No spinner glyph and no refreshing hook — colour passthrough only.
    expect(chip.textContent).not.toContain("⟳");
    expect(chip.getAttribute("data-refreshing")).not.toBe("true");
  });

  it("unreachable takes precedence over pending (a known crash outranks an ambiguous reclaim)", () => {
    const { getByTestId } = render(
      <DepthChip
        depth={3}
        status="wired"
        chipColor="green"
        unreachable
        pending
      />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.getAttribute("data-status")).toBe("unreachable");
    expect(chip.className).toContain("indigo");
  });

  it("renders normally (no pending) when pending=false", () => {
    const { getByTestId } = render(
      <DepthChip depth={5} status="wired" chipColor="green" pending={false} />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.getAttribute("data-status")).not.toBe("pending");
    expect(chip.className).toContain("emerald");
  });
});

describe("depthColorClass (direct)", () => {
  // (i) depthColorClass(4, false, 4) → green (at ceiling)
  it("(i) depthColorClass(4, 4) → green", () => {
    expect(depthColorClass(4, false, 4)).toContain("emerald");
  });

  // (j) depthColorClass(4, false, 5) → amber (1 below)
  it("(j) depthColorClass(4, 5) → amber", () => {
    expect(depthColorClass(4, false, 5)).toContain("amber");
  });

  // (k) depthColorClass(3, false, 5) → amber (2 below)
  it("(k) depthColorClass(3, 5) → amber", () => {
    expect(depthColorClass(3, false, 5)).toContain("amber");
  });

  // (l) depthColorClass(2, false, 5) → red (3 below)
  it("(l) depthColorClass(2, 5) → red", () => {
    expect(depthColorClass(2, false, 5)).toContain("danger");
  });

  // (m) depthColorClass(5, false, 5) → green (at ceiling)
  it("(m) depthColorClass(5, 5) → green", () => {
    expect(depthColorClass(5, false, 5)).toContain("emerald");
  });

  // (n) depthColorClass(0, false, anything) → gray
  it("(n) depthColorClass(0, 5) → gray", () => {
    expect(depthColorClass(0, false, 5)).toContain("text-muted");
  });

  it("(n) depthColorClass(0, 0) → gray", () => {
    expect(depthColorClass(0, false, 0)).toContain("text-muted");
  });

  it("(n) depthColorClass(0, 4) → gray", () => {
    expect(depthColorClass(0, false, 4)).toContain("text-muted");
  });

  // Additional: D6 at ceiling
  it("depthColorClass(6, 6) → green", () => {
    expect(depthColorClass(6, false, 6)).toContain("emerald");
  });

  // Additional: regression overrides everything
  it("regression overrides green", () => {
    expect(depthColorClass(5, true, 5)).toContain("danger");
  });

  it("regression overrides amber", () => {
    expect(depthColorClass(4, true, 6)).toContain("danger");
  });

  // Additional: D1 with maxDepth=6 → red (5 below)
  it("depthColorClass(1, 6) → red", () => {
    expect(depthColorClass(1, false, 6)).toContain("danger");
  });
});

describe("DepthChip with chipColor prop", () => {
  it("renders green when chipColor='green' regardless of depth", () => {
    const { getByTestId } = render(
      <DepthChip depth={3} status="wired" chipColor="green" />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("emerald");
  });

  it("renders amber when chipColor='amber'", () => {
    const { getByTestId } = render(
      <DepthChip depth={4} status="wired" chipColor="amber" />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("amber");
  });

  it("renders red when chipColor='red'", () => {
    const { getByTestId } = render(
      <DepthChip depth={3} status="wired" chipColor="red" />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("danger");
  });

  it("renders gray when chipColor='gray'", () => {
    const { getByTestId } = render(
      <DepthChip depth={0} status="wired" chipColor="gray" />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("text-muted");
  });

  it("chipColor takes precedence over maxDepth when both provided", () => {
    // maxDepth=5 with depth=4 would normally be amber, but chipColor overrides
    const { getByTestId } = render(
      <DepthChip depth={4} status="wired" maxDepth={5} chipColor="green" />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("emerald");
  });

  it("falls back to depthColorClass when chipColor not provided", () => {
    // Backwards compat: D5 with no chipColor should still be green via fallback
    const { getByTestId } = render(<DepthChip depth={5} status="wired" />);
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("emerald");
  });

  it("regression overrides chipColor='green' with danger", () => {
    const { getByTestId } = render(
      <DepthChip depth={5} status="wired" chipColor="green" regression />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("danger");
  });
});

describe("chipColorToClass (direct)", () => {
  it("green → emerald class", () => {
    expect(chipColorToClass("green")).toContain("emerald");
  });

  it("amber → amber class", () => {
    expect(chipColorToClass("amber")).toContain("amber");
  });

  it("red → danger class", () => {
    expect(chipColorToClass("red")).toContain("danger");
  });

  it("gray → text-muted class", () => {
    expect(chipColorToClass("gray")).toContain("text-muted");
  });

  it("regression overrides any color to danger", () => {
    expect(chipColorToClass("green", true)).toContain("danger");
    expect(chipColorToClass("amber", true)).toContain("danger");
    expect(chipColorToClass("gray", true)).toContain("danger");
  });
});
