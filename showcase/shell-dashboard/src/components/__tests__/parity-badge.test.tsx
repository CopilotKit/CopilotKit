/**
 * Unit tests for ParityBadge — correct label + color for each tier.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ParityBadge, type ParityTier } from "../parity-badge";

describe("ParityBadge", () => {
  const tiers: Array<{ tier: ParityTier; label: string; colorHint: string }> = [
    { tier: "reference", label: "REF", colorHint: "purple" },
    { tier: "at_parity", label: "AT PARITY", colorHint: "ok" },
    { tier: "partial", label: "PARTIAL", colorHint: "amber" },
    { tier: "minimal", label: "MINIMAL", colorHint: "amber" },
    { tier: "not_wired", label: "NOT WIRED", colorHint: "text-muted" },
  ];

  it.each(tiers)(
    "renders $label for tier=$tier",
    ({ tier, label }) => {
      const { getByTestId } = render(<ParityBadge tier={tier} />);
      const badge = getByTestId("parity-badge");
      expect(badge.textContent).toBe(label);
    },
  );

  it.each(tiers)(
    "uses correct color class for tier=$tier",
    ({ tier, colorHint }) => {
      const { getByTestId } = render(<ParityBadge tier={tier} />);
      const badge = getByTestId("parity-badge");
      expect(badge.className).toContain(colorHint);
    },
  );

  it("renders minimal with reduced opacity", () => {
    const { getByTestId } = render(<ParityBadge tier="minimal" />);
    const badge = getByTestId("parity-badge");
    expect(badge.className).toContain("opacity");
  });
});
