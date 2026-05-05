/**
 * Unit tests for DepthChip — renders correct text + class for D0-D6,
 * unshipped, unsupported, regression, and relative-to-maxDepth color logic.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DepthChip, depthColorClass } from "../depth-chip";

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
