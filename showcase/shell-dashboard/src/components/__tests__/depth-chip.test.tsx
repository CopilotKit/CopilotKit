/**
 * Unit tests for DepthChip — renders correct text + class for D0-D4,
 * unshipped, and regression states.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DepthChip } from "../depth-chip";

describe("DepthChip", () => {
  it.each([0, 1, 2, 3, 4])(
    "renders D%i for depth=%i with wired status",
    (depth) => {
      const { getByTestId } = render(
        <DepthChip depth={depth as 0 | 1 | 2 | 3 | 4} status="wired" />,
      );
      const chip = getByTestId("depth-chip");
      expect(chip.textContent).toBe(`D${depth}`);
    },
  );

  it("renders D0 with gray background class", () => {
    const { getByTestId } = render(<DepthChip depth={0} status="wired" />);
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("text-muted");
  });

  it("renders D1 with amber background class", () => {
    const { getByTestId } = render(<DepthChip depth={1} status="wired" />);
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("amber");
  });

  it("renders D2 with amber background class", () => {
    const { getByTestId } = render(<DepthChip depth={2} status="wired" />);
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("amber");
  });

  it("renders D3 with blue/accent background class", () => {
    const { getByTestId } = render(<DepthChip depth={3} status="wired" />);
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("accent");
  });

  it("renders D4 with blue/accent background class", () => {
    const { getByTestId } = render(<DepthChip depth={4} status="wired" />);
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("accent");
  });

  it("renders '--' for unshipped status with dashed border", () => {
    const { getByTestId } = render(<DepthChip depth={0} status="unshipped" />);
    const chip = getByTestId("depth-chip");
    expect(chip.textContent).toBe("--");
    expect(chip.className).toContain("border-dashed");
  });

  it("renders stub status same as wired (D0 gray)", () => {
    const { getByTestId } = render(<DepthChip depth={0} status="stub" />);
    const chip = getByTestId("depth-chip");
    expect(chip.textContent).toBe("D0");
  });

  it("renders regression with danger color", () => {
    const { getByTestId } = render(
      <DepthChip depth={2} status="wired" regression />,
    );
    const chip = getByTestId("depth-chip");
    expect(chip.className).toContain("danger");
  });
});
