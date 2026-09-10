// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WizardCard, WizardNav, WizardProgress } from "../wizard-stepper-parts";
import type { StepperStep } from "../wizard-stepper-parts";

afterEach(() => {
  cleanup();
});

const STEPS: readonly StepperStep[] = [
  { n: 1, label: "Your frontend" },
  { n: 2, label: "Your agent backend" },
  { n: 3, label: "What you want to build" },
  { n: 4, label: "Copy your prompt" },
];

describe("WizardCard", () => {
  // The core treatment is the border, the background token and the panel
  // shadow *together* — a test that only asserted one shared substring (like
  // `var(--shadow-panel)` alone, or `var(--accent)`, which also appears in
  // other unrelated component states) would pass even if the other pieces
  // of the treatment were dropped.
  it("renders a section with the core treatment: border, surface background and panel shadow", () => {
    const { container } = render(
      <WizardCard step={1} total={4} name="N" description="D" footer={<span />}>
        <span />
      </WizardCard>,
    );

    const section = container.querySelector("section");
    expect(section).not.toBeNull();
    const className = section!.className;
    expect(className).toContain("border-[var(--border)]");
    expect(className).toContain("bg-[var(--bg-surface)]");
    expect(className).toContain("shadow-[var(--shadow-panel)]");
  });

  it("renders the kicker as Step {step} of {total}", () => {
    render(
      <WizardCard step={2} total={4} name="N" description="D" footer={<span />}>
        <span />
      </WizardCard>,
    );

    expect(screen.getByText("Step 2 of 4")).not.toBeNull();
  });

  it("renders an h2 whose text is exactly name and which carries tabIndex=-1", () => {
    render(
      <WizardCard
        step={1}
        total={4}
        name="Your frontend"
        description="D"
        footer={<span />}
      >
        <span />
      </WizardCard>,
    );

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe("Your frontend");
    expect(heading.getAttribute("tabindex")).toBe("-1");
  });

  it("renders children and footer", () => {
    render(
      <WizardCard
        step={1}
        total={4}
        name="N"
        description="D"
        footer={<span>the footer</span>}
      >
        <p>the child</p>
      </WizardCard>,
    );

    expect(screen.getByText("the child")).not.toBeNull();
    expect(screen.getByText("the footer")).not.toBeNull();
  });
});

describe("WizardProgress", () => {
  it("gives the current step aria-current=step and no other step", () => {
    render(
      <WizardProgress
        steps={STEPS}
        current={2}
        furthest={3}
        onJump={vi.fn()}
      />,
    );

    const current = screen.getByRole("button", { name: /Your agent backend/ });
    expect(current.getAttribute("aria-current")).toBe("step");

    const others = STEPS.filter((s) => s.n !== 2);
    for (const step of others) {
      const button = screen.getByRole("button", {
        name: new RegExp(step.label),
      });
      expect(button.getAttribute("aria-current")).toBeNull();
    }
  });

  it("disables steps beyond furthest and leaves steps at or below it enabled", () => {
    render(
      <WizardProgress
        steps={STEPS}
        current={2}
        furthest={2}
        onJump={vi.fn()}
      />,
    );

    for (const step of STEPS) {
      const button = screen.getByRole("button", {
        name: new RegExp(step.label),
      }) as HTMLButtonElement;
      if (step.n > 2) {
        expect(button.disabled).toBe(true);
        expect(button.hasAttribute("disabled")).toBe(true);
      } else {
        expect(button.disabled).toBe(false);
        expect(button.hasAttribute("disabled")).toBe(false);
      }
    }
  });

  it("calls onJump with the step's number when a reached step is clicked", () => {
    const onJump = vi.fn();
    render(
      <WizardProgress steps={STEPS} current={3} furthest={3} onJump={onJump} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Your frontend/ }));

    expect(onJump).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("does not call onJump when a disabled (unreached) step is clicked", () => {
    const onJump = vi.fn();
    render(
      <WizardProgress steps={STEPS} current={1} furthest={1} onJump={onJump} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Copy your prompt/ }));

    expect(onJump).not.toHaveBeenCalled();
  });
});

describe("WizardNav", () => {
  it("omits Back entirely when onBack is absent", () => {
    render(
      <WizardNav
        onContinue={vi.fn()}
        continueLabel="Continue"
        continueDisabled={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("renders Back when onBack is present", () => {
    render(
      <WizardNav
        onBack={vi.fn()}
        onContinue={vi.fn()}
        continueLabel="Continue"
        continueDisabled={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Back" })).not.toBeNull();
  });

  it("calls onBack when Back is clicked", () => {
    const onBack = vi.fn();
    render(
      <WizardNav
        onBack={onBack}
        onContinue={vi.fn()}
        continueLabel="Continue"
        continueDisabled={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("labels Continue with continueLabel", () => {
    render(
      <WizardNav
        onContinue={vi.fn()}
        continueLabel="Skip"
        continueDisabled={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Skip" })).not.toBeNull();
  });

  it("follows continueDisabled on the Continue button's disabled attribute", () => {
    const { rerender } = render(
      <WizardNav
        onContinue={vi.fn()}
        continueLabel="Continue"
        continueDisabled={true}
      />,
    );

    let button = screen.getByRole("button", {
      name: "Continue",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    rerender(
      <WizardNav
        onContinue={vi.fn()}
        continueLabel="Continue"
        continueDisabled={false}
      />,
    );

    button = screen.getByRole("button", {
      name: "Continue",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("does not call onContinue when Continue is disabled", () => {
    const onContinue = vi.fn();
    render(
      <WizardNav
        onContinue={onContinue}
        continueLabel="Continue"
        continueDisabled={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(onContinue).not.toHaveBeenCalled();
  });

  it("calls onContinue when Continue is enabled and clicked", () => {
    const onContinue = vi.fn();
    render(
      <WizardNav
        onContinue={onContinue}
        continueLabel="Continue"
        continueDisabled={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(onContinue).toHaveBeenCalledExactlyOnceWith();
  });
});
