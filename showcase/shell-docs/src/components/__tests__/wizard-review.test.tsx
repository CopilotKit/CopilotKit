// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WizardReview } from "../wizard-review";

const FRONTEND = {
  name: "Vue",
  logo: { kind: "frontend", icon: "vue" },
} as const;

const BACKEND = {
  name: "Mastra",
  logo: { kind: "framework", slug: "mastra" },
} as const;

const FEATURES = [
  { id: "chat", title: "Chat surface", icon: "MessageSquare" },
  { id: "gen-ui", title: "Generative UI", icon: "Paintbrush" },
] as const;

afterEach(() => {
  cleanup();
});

describe("all three answers", () => {
  it("render with their values", () => {
    render(
      <WizardReview
        frontend={FRONTEND}
        backend={BACKEND}
        features={FEATURES}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText("Vue")).not.toBeNull();
    expect(screen.getByText("Mastra")).not.toBeNull();
    expect(screen.getByText("Chat surface")).not.toBeNull();
    expect(screen.getByText("Generative UI")).not.toBeNull();
  });
});

// Each tile is the whole click target, not a row with a small trailing
// control, and each needs its own accessible name — three separate cases,
// one per tile, each starting its own render, so a mutation that points
// every tile at the same step (or gives every tile the same name) fails
// here rather than being masked by only ever checking the first tile.
describe("tile navigation", () => {
  it("Change frontend calls onNavigate with 1", () => {
    const onNavigate = vi.fn();
    render(
      <WizardReview
        frontend={FRONTEND}
        backend={BACKEND}
        features={FEATURES}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Change frontend" }));

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("Change agent backend calls onNavigate with 2", () => {
    const onNavigate = vi.fn();
    render(
      <WizardReview
        frontend={FRONTEND}
        backend={BACKEND}
        features={FEATURES}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Change agent backend" }),
    );

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("Change features calls onNavigate with 3", () => {
    const onNavigate = vi.fn();
    render(
      <WizardReview
        frontend={FRONTEND}
        backend={BACKEND}
        features={FEATURES}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Change features" }));

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(3);
  });
});

describe("empty features", () => {
  it("renders a muted None, and the tile still calls onNavigate with 3", () => {
    const onNavigate = vi.fn();
    render(
      <WizardReview
        frontend={FRONTEND}
        backend={BACKEND}
        features={[]}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByText("None")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change features" }));

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(3);
  });
});

describe("several features", () => {
  it("renders one entry per feature, each with its own icon", () => {
    render(
      <WizardReview
        frontend={FRONTEND}
        backend={BACKEND}
        features={FEATURES}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText("Chat surface")).not.toBeNull();
    expect(screen.getByText("Generative UI")).not.toBeNull();

    const featuresTile = screen.getByRole("button", {
      name: "Change features",
    });
    // One <svg> icon per feature — not one icon shared across the list.
    expect(featuresTile.querySelectorAll("svg")).toHaveLength(FEATURES.length);
  });
});

describe("selection state", () => {
  it("no tile carries aria-pressed — these are navigation, never a choice", () => {
    render(
      <WizardReview
        frontend={FRONTEND}
        backend={BACKEND}
        features={FEATURES}
        onNavigate={vi.fn()}
      />,
    );

    screen.getAllByRole("button").forEach((button) => {
      expect(button.hasAttribute("aria-pressed")).toBe(false);
    });
  });
});
