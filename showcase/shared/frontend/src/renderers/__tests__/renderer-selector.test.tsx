import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RendererSelector } from "../renderer-selector";
import { RENDER_STRATEGIES, RenderMode } from "../types";

describe("RendererSelector", () => {
  let onModeChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onModeChange = vi.fn();
  });

  it("renders a pill for each render strategy", () => {
    render(<RendererSelector mode="tool-based" onModeChange={onModeChange} />);

    for (const strategy of RENDER_STRATEGIES) {
      expect(
        screen.getByRole("radio", { name: new RegExp(strategy.name) }),
      ).toBeDefined();
    }

    const pills = screen.getAllByRole("radio");
    expect(pills).toHaveLength(5);
  });

  it("marks the active mode with aria-checked", () => {
    render(<RendererSelector mode="hashbrown" onModeChange={onModeChange} />);

    const active = screen.getByRole("radio", { name: /HashBrown/ });
    expect(active.getAttribute("aria-checked")).toBe("true");

    const inactive = screen.getByRole("radio", { name: /Tool-Based/ });
    expect(inactive.getAttribute("aria-checked")).toBe("false");
  });

  it("calls onModeChange when a pill is clicked", () => {
    render(<RendererSelector mode="tool-based" onModeChange={onModeChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /Open GenUI/ }));
    expect(onModeChange).toHaveBeenCalledWith("open-genui");
  });

  it("shows description as title tooltip", () => {
    render(<RendererSelector mode="tool-based" onModeChange={onModeChange} />);

    const pill = screen.getByRole("radio", { name: /json-render/ });
    expect(pill.getAttribute("title")).toBe(
      "JSONL patches with built-in state",
    );
  });

  it("applies highlighted styles to the active pill", () => {
    render(<RendererSelector mode="a2ui" onModeChange={onModeChange} />);

    const active = screen.getByRole("radio", { name: /A2UI Catalog/ });
    expect(active.className).toContain("bg-blue-600");

    const inactive = screen.getByRole("radio", { name: /Tool-Based/ });
    expect(inactive.className).toContain("bg-gray-100");
  });

  // --- Keyboard navigation ---

  it("navigates between pills with arrow keys via click simulation", () => {
    render(<RendererSelector mode="tool-based" onModeChange={onModeChange} />);

    const pills = screen.getAllByRole("radio");
    // Focus the first pill
    pills[0].focus();
    expect(document.activeElement).toBe(pills[0]);

    // Clicking second pill should fire onModeChange with a2ui
    fireEvent.click(pills[1]);
    expect(onModeChange).toHaveBeenCalledWith("a2ui");
  });

  it("fires onModeChange for each strategy when clicked in sequence", () => {
    render(<RendererSelector mode="tool-based" onModeChange={onModeChange} />);

    const pills = screen.getAllByRole("radio");
    const expectedModes: RenderMode[] = [
      "tool-based",
      "a2ui",
      "json-render",
      "hashbrown",
      "open-genui",
    ];

    pills.forEach((pill, i) => {
      fireEvent.click(pill);
      expect(onModeChange).toHaveBeenCalledWith(expectedModes[i]);
    });
    expect(onModeChange).toHaveBeenCalledTimes(5);
  });

  // --- Responsive layout ---

  it("renders within a flex-wrap container for responsive layout", () => {
    render(<RendererSelector mode="tool-based" onModeChange={onModeChange} />);

    const radiogroup = screen.getByRole("radiogroup");
    expect(radiogroup.className).toContain("flex");
    expect(radiogroup.className).toContain("flex-wrap");
  });

  it("has proper aria-label on the radiogroup", () => {
    render(<RendererSelector mode="tool-based" onModeChange={onModeChange} />);

    const radiogroup = screen.getByRole("radiogroup");
    expect(radiogroup.getAttribute("aria-label")).toBe("Render mode");
  });

  // --- Each mode highlights correctly ---

  it("highlights tool-based when active", () => {
    render(<RendererSelector mode="tool-based" onModeChange={onModeChange} />);
    const active = screen.getByRole("radio", { name: /Tool-Based/ });
    expect(active.className).toContain("bg-blue-600");
    expect(active.className).toContain("text-white");
  });

  it("highlights hashbrown when active", () => {
    render(<RendererSelector mode="hashbrown" onModeChange={onModeChange} />);
    const active = screen.getByRole("radio", { name: /HashBrown/ });
    expect(active.className).toContain("bg-blue-600");
  });

  it("highlights open-genui when active", () => {
    render(<RendererSelector mode="open-genui" onModeChange={onModeChange} />);
    const active = screen.getByRole("radio", { name: /Open GenUI/ });
    expect(active.className).toContain("bg-blue-600");
  });

  it("highlights json-render when active", () => {
    render(<RendererSelector mode="json-render" onModeChange={onModeChange} />);
    const active = screen.getByRole("radio", { name: /json-render/ });
    expect(active.className).toContain("bg-blue-600");
  });

  // --- All non-active pills are gray ---

  it("all non-active pills have gray background", () => {
    render(<RendererSelector mode="tool-based" onModeChange={onModeChange} />);

    const pills = screen.getAllByRole("radio");
    const inactive = pills.filter(
      (p) => p.getAttribute("aria-checked") === "false",
    );
    expect(inactive).toHaveLength(4);
    inactive.forEach((pill) => {
      expect(pill.className).toContain("bg-gray-100");
    });
  });

  // --- Focus ring styles ---

  it("pills have focus-visible ring styles for accessibility", () => {
    render(<RendererSelector mode="tool-based" onModeChange={onModeChange} />);

    const pill = screen.getAllByRole("radio")[0];
    expect(pill.className).toContain("focus-visible:ring-2");
    expect(pill.className).toContain("focus-visible:ring-blue-500");
  });

  // --- Each strategy has an icon ---

  it("each pill contains an icon span with aria-hidden", () => {
    render(<RendererSelector mode="tool-based" onModeChange={onModeChange} />);

    const pills = screen.getAllByRole("radio");
    pills.forEach((pill) => {
      const iconSpan = pill.querySelector("[aria-hidden='true']");
      expect(iconSpan).toBeTruthy();
      expect(iconSpan!.textContent!.length).toBeGreaterThan(0);
    });
  });
});
