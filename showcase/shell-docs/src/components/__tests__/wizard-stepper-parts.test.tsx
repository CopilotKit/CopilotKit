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

  // The four steps measured 306/516/500/252px tall at a 644px card width —
  // without a floor, every advance resized the page and shifted whatever
  // sits below the wizard. The floor is `md:` and up only: on a narrow
  // screen the option grid collapses toward one column, so the backend step
  // grows far taller than any floor worth setting, and forcing that height
  // on a phone would be worse than the shift it prevents. Asserting the
  // `md:` prefix specifically (not just that *a* min-height class exists)
  // is what catches a change that applies the floor unconditionally.
  it("gives the card a minimum height starting at the md breakpoint, not unconditionally", () => {
    const { container } = render(
      <WizardCard step={1} total={4} name="N" description="D" footer={<span />}>
        <span />
      </WizardCard>,
    );

    const section = container.querySelector("section");
    expect(section).not.toBeNull();
    const className = section!.className;
    expect(className).toMatch(/\bmd:min-h-\S+/);
    expect(className).not.toMatch(/(?<!md:)\bmin-h-\S+/);
  });

  // The footer must land at the same bottom edge on every step regardless
  // of how tall the step's own content is, which is what lets a short step
  // (like step 4) show its Back/Continue row where a tall step's row
  // already sits. Pinning it there needs both the card being a flex column
  // and the footer wrapper carrying `mt-auto` (or an equivalent) — assert
  // both, since either alone does nothing.
  it("lays the card out as a flex column with the footer pushed to the bottom", () => {
    const { container } = render(
      <WizardCard
        step={1}
        total={4}
        name="N"
        description="D"
        footer={<span>the footer</span>}
      >
        <span />
      </WizardCard>,
    );

    const section = container.querySelector("section");
    expect(section).not.toBeNull();
    expect(section!.className).toMatch(/\bflex\b/);
    expect(section!.className).toMatch(/\bflex-col\b/);

    const footerNode = screen.getByText("the footer");
    const footerWrapper = footerNode.parentElement;
    expect(footerWrapper).not.toBeNull();
    expect(footerWrapper!.className).toMatch(/\bmt-auto\b/);
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

  // Tailwind v4 no longer gives <button> a pointer cursor by default. This
  // pairs the plain `cursor-pointer` with the `disabled:cursor-not-allowed`
  // already asserted above — a `:disabled` pseudo-class selector outranks a
  // plain class in specificity, so the not-allowed cursor always wins on an
  // actually-disabled button regardless of source order.
  it("shows a pointer cursor on a reached (enabled) step", () => {
    render(
      <WizardProgress
        steps={STEPS}
        current={1}
        furthest={2}
        onJump={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: /Your agent backend/ });
    expect(button.className).toContain("cursor-pointer");
  });

  it("pairs the pointer cursor with a not-allowed cursor for unreached steps", () => {
    render(
      <WizardProgress
        steps={STEPS}
        current={1}
        furthest={1}
        onJump={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: /Your agent backend/ });
    expect(button.className).toContain("disabled:cursor-not-allowed");
  });
});

describe("WizardNav", () => {
  it("omits Back entirely when onBack is absent", () => {
    render(<WizardNav onContinue={vi.fn()} continueLabel="Continue" />);

    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("renders Back when onBack is present", () => {
    render(
      <WizardNav
        onBack={vi.fn()}
        onContinue={vi.fn()}
        continueLabel="Continue"
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
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("labels Continue with continueLabel", () => {
    render(<WizardNav onContinue={vi.fn()} continueLabel="Skip" />);

    expect(screen.getByRole("button", { name: "Skip" })).not.toBeNull();
  });

  // Continue used to carry a `continueDisabled` prop and the real `disabled`
  // attribute with it — the reader clicking it right under a stationary
  // mouse would flip the cursor from pointer to not-allowed. It is now
  // always enabled: no prop varies this any more, so this simply asserts
  // the button never carries the attribute at all. This is one of the five
  // mutation-checked guards; re-adding `disabled={...}` to the button must
  // make it fail.
  it("never renders the Continue button with the disabled attribute", () => {
    render(
      <WizardNav
        onContinue={vi.fn()}
        continueLabel="Continue"
        hint="Choose your frontend first"
      />,
    );

    const button = screen.getByRole("button", {
      name: "Continue",
    }) as HTMLButtonElement;
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.disabled).toBe(false);
  });

  it("calls onContinue when Continue is clicked", () => {
    const onContinue = vi.fn();
    render(<WizardNav onContinue={onContinue} continueLabel="Continue" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(onContinue).toHaveBeenCalledExactlyOnceWith();
  });

  // The Continue/Copy button's label changes shape across the wizard (Skip,
  // Continue, Copy prompt, Copied, Copy blocked); without a floor the
  // button itself resized on every swap. Render it with a short and a long
  // label and assert the *same* min-width class both times — a class that
  // merely exists but happens to differ per label would still let the
  // button resize.
  it("gives the Continue button a fixed minimum width independent of its label", () => {
    const { rerender } = render(
      <WizardNav onContinue={vi.fn()} continueLabel="Skip" />,
    );
    const shortClassName = screen.getByRole("button", {
      name: "Skip",
    }).className;
    const shortMinWidth = shortClassName.match(/\bmin-w-\S+/)?.[0];
    expect(shortMinWidth).toBeTruthy();

    rerender(<WizardNav onContinue={vi.fn()} continueLabel="Copy blocked" />);
    const longClassName = screen.getByRole("button", {
      name: "Copy blocked",
    }).className;
    const longMinWidth = longClassName.match(/\bmin-w-\S+/)?.[0];

    expect(longMinWidth).toBe(shortMinWidth);
  });

  it("renders the continueIcon before the label when given", () => {
    render(
      <WizardNav
        onContinue={vi.fn()}
        continueLabel="Copy prompt"
        continueIcon={<span data-testid="continue-icon" />}
      />,
    );

    const button = screen.getByRole("button", { name: "Copy prompt" });
    expect(
      button.querySelector('[data-testid="continue-icon"]'),
    ).not.toBeNull();
  });

  it("omits the icon slot entirely when continueIcon is not given", () => {
    render(<WizardNav onContinue={vi.fn()} continueLabel="Copy prompt" />);

    const button = screen.getByRole("button", { name: "Copy prompt" });
    expect(button.querySelector('[data-testid="continue-icon"]')).toBeNull();
  });

  it("shows a pointer cursor on Continue", () => {
    render(<WizardNav onContinue={vi.fn()} continueLabel="Continue" />);

    const button = screen.getByRole("button", { name: "Continue" });
    expect(button.className).toContain("cursor-pointer");
  });

  it("shows a pointer cursor on the Back button", () => {
    render(
      <WizardNav
        onBack={vi.fn()}
        onContinue={vi.fn()}
        continueLabel="Continue"
      />,
    );

    expect(screen.getByRole("button", { name: "Back" }).className).toContain(
      "cursor-pointer",
    );
  });

  // The hint row must exist in the DOM whether or not `hint` is set — this
  // is what lets it clear/appear without reflowing the footer, since there
  // is never a moment the row itself is mounted or unmounted. Asserting
  // that the *same node* persists across a hint appearing (rather than just
  // "a paragraph with this text exists" after the rerender) is what catches
  // a conditional-render regression: mutation (e) — rendering the row only
  // when `hint` is present — leaves the row missing entirely on the first,
  // hint-less render, so the very first assertion below already fails.
  it("always renders the hint row, reserved whether or not hint is set", () => {
    const { rerender } = render(
      <WizardNav onContinue={vi.fn()} continueLabel="Continue" />,
    );

    const emptyRow = document.querySelector('[aria-live="polite"]');
    expect(emptyRow).not.toBeNull();
    expect(emptyRow!.textContent).toBe("");

    rerender(
      <WizardNav
        onContinue={vi.fn()}
        continueLabel="Continue"
        hint="Choose your frontend first"
      />,
    );

    const filledRow = document.querySelector('[aria-live="polite"]');
    expect(filledRow).toBe(emptyRow);
    expect(filledRow!.textContent).toBe("Choose your frontend first");
  });

  // The hint is guidance, not an error — `role="alert"` would be wrong here
  // (it implies something failed) and its assertive live region would also
  // interrupt whatever the reader's screen reader is already announcing.
  // `aria-live="polite"` is what actually gets the hint announced: the
  // reader's blocked click also moves focus into the option list (see
  // `setup-wizard.tsx`), so the hint text is never on the focused element
  // itself for an `aria-describedby` wiring to pick up.
  it("exposes the hint through a polite live region, never role=alert", () => {
    render(
      <WizardNav
        onContinue={vi.fn()}
        continueLabel="Continue"
        hint="Choose your frontend first"
      />,
    );

    const hintRow = document.querySelector('[aria-live="polite"]');
    expect(hintRow).not.toBeNull();
    expect(hintRow!.getAttribute("role")).not.toBe("alert");
  });
});
