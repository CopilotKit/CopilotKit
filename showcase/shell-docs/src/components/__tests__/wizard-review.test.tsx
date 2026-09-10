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

// Each row is the whole click target, not a small trailing control, and
// each needs its own accessible name — three separate cases, one per row,
// each starting its own render, so a mutation that points every row at the
// same step (or gives every row the same name) fails here rather than being
// masked by only ever checking the first row. `fireEvent.click`'s default
// `detail` is `0` — the same value a real keyboard-triggered click reports —
// so every plain `fireEvent.click` below exercises the keyboard branch; see
// "row activation reports how it was triggered" below for the pointer one.
describe("row navigation", () => {
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

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1, false);
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

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(2, false);
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

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(3, false);
  });
});

// `pointerActivated` (`event.detail > 0`) is computed inside the row's own
// click handler and handed to `onNavigate` as a plain boolean — never the
// raw event — the same shape `WizardNav`/`WizardProgress` already report.
// `setup-wizard.tsx` uses it to decide whether the target step's heading
// shows a focus ring, so a row must report it accurately rather than always
// reporting the keyboard branch.
describe("row activation reports how it was triggered", () => {
  it("a pointer-driven click reports pointerActivated: true", () => {
    const onNavigate = vi.fn();
    render(
      <WizardReview
        frontend={FRONTEND}
        backend={BACKEND}
        features={FEATURES}
        onNavigate={onNavigate}
      />,
    );

    // A programmatic `.click()` — and `fireEvent.click`'s default — reports
    // `detail: 0`, indistinguishable from a keyboard activation, so the
    // pointer case needs an explicit non-zero `detail`.
    fireEvent.click(screen.getByRole("button", { name: "Change frontend" }), {
      detail: 1,
    });

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1, true);
  });

  it("a keyboard-driven click reports pointerActivated: false", () => {
    const onNavigate = vi.fn();
    render(
      <WizardReview
        frontend={FRONTEND}
        backend={BACKEND}
        features={FEATURES}
        onNavigate={onNavigate}
      />,
    );

    // No `detail` override: fireEvent.click's default of 0 is the keyboard
    // branch (see the header comment above).
    fireEvent.click(screen.getByRole("button", { name: "Change frontend" }));

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1, false);
  });
});

describe("empty features", () => {
  it("renders a muted None, and the row still calls onNavigate with 3", () => {
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

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(3, false);
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

    const featuresRow = screen.getByRole("button", {
      name: "Change features",
    });
    // One <svg> icon per feature — not one icon shared across the list.
    expect(featuresRow.querySelectorAll("svg")).toHaveLength(FEATURES.length);
  });
});

describe("selection state", () => {
  it("no row carries aria-pressed — these are navigation, never a choice", () => {
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

// The step numbers are what makes the panel read as "your answer to each
// step" rather than a fresh grid of options (see this component's header
// comment) — asserted in document order, one per row, since a mutation that
// numbers every row the same or numbers them out of order would otherwise
// go unnoticed.
describe("step numbers", () => {
  it("each row leads with its own step number, 1, 2, 3 in order", () => {
    render(
      <WizardReview
        frontend={FRONTEND}
        backend={BACKEND}
        features={FEATURES}
        onNavigate={vi.fn()}
      />,
    );

    const rows = [
      screen.getByRole("button", { name: "Change frontend" }),
      screen.getByRole("button", { name: "Change agent backend" }),
      screen.getByRole("button", { name: "Change features" }),
    ];
    const numbers = rows.map((row) => row.firstElementChild?.textContent);

    expect(numbers).toEqual(["1", "2", "3"]);
  });
});

// Regression coverage for the panel's centring: the card's content area
// (`WizardCard` in `wizard-stepper-parts.tsx`) is `flex flex-1 flex-col
// justify-center`, so a panel with no `flex-1` of its own is centred rather
// than stretched to fill the card. A `flex-1` reintroduced here would fill
// the card again, exactly the tile-era layout this replaces.
describe("panel layout", () => {
  it("does not carry flex-1, so it is centred rather than stretched", () => {
    const { container } = render(
      <WizardReview
        frontend={FRONTEND}
        backend={BACKEND}
        features={FEATURES}
        onNavigate={vi.fn()}
      />,
    );

    const panel = container.firstElementChild;
    expect(panel).not.toBeNull();
    expect(panel?.className).not.toMatch(/\bflex-1\b/);
  });
});
