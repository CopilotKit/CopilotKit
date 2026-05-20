/**
 * Unit tests for OverlayToggleBar — overlay pills + preset buttons.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { OverlayToggleBar, ALL_OVERLAYS, PRESETS } from "../overlay-toggle-bar";
import type { Overlay } from "../overlay-toggle-bar";

function renderBar(
  overrides: {
    overlays?: Set<Overlay>;
    activePreset?: string | null;
  } = {},
) {
  const onToggle = vi.fn();
  const onApplyPreset = vi.fn();
  const overlays = overrides.overlays ?? new Set<Overlay>();
  const activePreset = overrides.activePreset ?? null;

  const result = render(
    <OverlayToggleBar
      overlays={overlays}
      onToggle={onToggle}
      onApplyPreset={onApplyPreset}
      activePreset={activePreset}
    />,
  );
  return { ...result, onToggle, onApplyPreset };
}

describe("OverlayToggleBar", () => {
  it("renders all 5 overlay pills", () => {
    const { getByTestId } = renderBar();
    for (const overlay of ALL_OVERLAYS) {
      expect(getByTestId(`overlay-pill-${overlay}`)).toBeTruthy();
    }
  });

  it("active overlays get the active styling class", () => {
    const { getByTestId } = renderBar({
      overlays: new Set<Overlay>(["links", "health"]),
    });
    const linksPill = getByTestId("overlay-pill-links");
    const depthPill = getByTestId("overlay-pill-depth");
    // Active pills have white text and accent bg
    expect(linksPill.className).toContain("text-white");
    expect(linksPill.className).toContain("bg-[var(--accent)]");
    // Inactive pills have muted text
    expect(depthPill.className).toContain("text-[var(--text-muted)]");
    expect(depthPill.className).not.toContain("text-white");
  });

  it("clicking a pill calls onToggle with the correct overlay", () => {
    const { getByTestId, onToggle } = renderBar();
    fireEvent.click(getByTestId("overlay-pill-depth"));
    expect(onToggle).toHaveBeenCalledWith("depth");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders all 3 preset buttons", () => {
    const { getByTestId } = renderBar();
    for (const preset of PRESETS) {
      expect(getByTestId(`preset-btn-${preset.id}`)).toBeTruthy();
    }
  });

  it("clicking a preset calls onApplyPreset with the correct preset ID", () => {
    const { getByTestId, onApplyPreset } = renderBar();
    fireEvent.click(getByTestId("preset-btn-assessment"));
    expect(onApplyPreset).toHaveBeenCalledWith("assessment");
    expect(onApplyPreset).toHaveBeenCalledTimes(1);
  });

  it("active preset gets highlighted styling", () => {
    const { getByTestId } = renderBar({ activePreset: "catalog" });
    const catalogBtn = getByTestId("preset-btn-catalog");
    const assessmentBtn = getByTestId("preset-btn-assessment");
    // Active preset has accent color and accent border
    expect(catalogBtn.className).toContain("text-[var(--accent)]");
    expect(catalogBtn.className).toContain("border-[var(--accent)]");
    // Inactive preset has muted text
    expect(assessmentBtn.className).toContain("text-[var(--text-muted)]");
  });

  it("parity pill gets purple color class when active", () => {
    const { getByTestId } = renderBar({
      overlays: new Set<Overlay>(["parity", "links"]),
    });
    const parityPill = getByTestId("overlay-pill-parity");
    const linksPill = getByTestId("overlay-pill-links");
    // Parity active: purple bg
    expect(parityPill.className).toContain("bg-[#7c3aed]");
    expect(parityPill.className).not.toContain("bg-[var(--accent)]");
    // Links active: standard accent bg (not purple)
    expect(linksPill.className).toContain("bg-[var(--accent)]");
    expect(linksPill.className).not.toContain("bg-[#7c3aed]");
  });
});
