// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Check, X } from "lucide-react";

import {
  ChoiceGrid,
  WizardCard,
  WizardNav,
  WizardProgress,
} from "../wizard-stepper-parts";
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

  // `showFocusRing` decides whether the heading's own focus ring class is
  // present, independent of the browser's own pointer/keyboard heuristic —
  // see `HEADING_FOCUS_RING_CLASS`'s doc comment. `setup-wizard.tsx` derives
  // this from the activating click's `event.detail`; here it's asserted
  // directly against the prop.
  it("renders the heading's focus ring class by default and when showFocusRing is true", () => {
    const { container } = render(
      <WizardCard step={1} total={4} name="N" description="D" footer={<span />}>
        <span />
      </WizardCard>,
    );
    const defaultHeading = container.querySelector("h2");
    expect(defaultHeading).not.toBeNull();
    expect(defaultHeading!.className).toMatch(/\bfocus:ring-2\b/);

    const { container: explicitContainer } = render(
      <WizardCard
        step={1}
        total={4}
        name="N"
        description="D"
        footer={<span />}
        showFocusRing
      >
        <span />
      </WizardCard>,
    );
    const explicitHeading = explicitContainer.querySelector("h2");
    expect(explicitHeading).not.toBeNull();
    expect(explicitHeading!.className).toMatch(/\bfocus:ring-2\b/);
  });

  it("omits the heading's focus ring class when showFocusRing is false", () => {
    const { container } = render(
      <WizardCard
        step={1}
        total={4}
        name="N"
        description="D"
        footer={<span />}
        showFocusRing={false}
      >
        <span />
      </WizardCard>,
    );

    const heading = container.querySelector("h2");
    expect(heading).not.toBeNull();
    expect(heading!.className).not.toMatch(/\bfocus:ring-2\b/);
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
  // already sits. Pinning it there needs the card to be a flex column AND the
  // content area above it to absorb the free space — assert both, since either
  // alone does nothing. The content area does the absorbing rather than an
  // `mt-auto` on the footer, because an auto margin claims a flex container's
  // free space ahead of any `flex-1` sibling, which starved step 4's review
  // grid and left it unable to fill the card.
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

    const child = container.querySelector("section > div.flex-1");
    expect(child).not.toBeNull();
    expect(child!.className).toMatch(/\bflex-col\b/);

    const footerNode = screen.getByText("the footer");
    const footerWrapper = footerNode.parentElement;
    expect(footerWrapper).not.toBeNull();
    // The growing content area is what pushes this down; an auto margin here
    // would take that room back off it.
    expect(footerWrapper!.className).not.toMatch(/\bmt-auto\b/);
  });

  // The options should sit the same distance from the description above them
  // as from the separator below, rather than hugging the text with all the
  // slack underneath. That symmetry is two halves: the content area centres
  // whatever slack is left, and its top margin matches the footer's top
  // padding so the fixed insets agree too. Assert both halves and both
  // breakpoint values — with only the centring asserted, a change to just one
  // of the two margins would drift them apart unnoticed.
  it("centres the content area and matches its top margin to the footer's top padding", () => {
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

    const content = container.querySelector("section > div.flex-1");
    expect(content).not.toBeNull();
    expect(content!.className).toMatch(/\bjustify-center\b/);
    // Symmetric padding, and no one-sided margin: a margin lands entirely
    // above the options, which is the lopsided gap this replaced.
    expect(content!.className).toMatch(/\bpy-2\b/);
    expect(content!.className).not.toMatch(/\b(mt|pt|mb|pb)-\d/);
  });

  // jsdom never lays anything out — every box reports zero size — so a
  // geometry assertion here ("the gap above equals the gap below") would be
  // vacuous no matter what the code does. What jsdom *can* see is which
  // utility classes produced that spacing, so this pins the actual pt-/pb-
  // values: the button row now carries the hint inside it instead of a
  // separate line underneath, so the footer wrapper's own top and bottom
  // padding are what has to match for the row to sit centred between the
  // separator above and the card's edge below. Naming both values (rather
  // than just asserting they're equal) makes a change to only one of them
  // fail here instead of silently drifting the two apart.
  it("gives the footer wrapper equal top and bottom padding around the button row", () => {
    render(
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

    const footerNode = screen.getByText("the footer");
    const footerWrapper = footerNode.parentElement;
    expect(footerWrapper).not.toBeNull();
    // The card's own `p-5 sm:p-6` supplies the space below the buttons, so
    // the footer only pays for the space above them — at the same values.
    // A bottom padding here would stack on the card's inset and reintroduce
    // the lopsided gap.
    expect(footerWrapper!.className).toMatch(/\bpt-5\b/);
    expect(footerWrapper!.className).toMatch(/\bsm:pt-6\b/);
    expect(footerWrapper!.className).not.toMatch(/\bpb-\d/);
    // An auto margin would absorb the free space that step 4's review grid
    // needs in order to fill the card.
    expect(footerWrapper!.className).not.toMatch(/\bmt-auto\b/);
  });
});

describe("ChoiceGrid", () => {
  // Check/cross, matching the actual pair the wizard wires in
  // `setup-wizard.tsx` (`PROJECT_ANSWER_ICONS` in `wizard-stepper-parts.tsx`)
  // rather than arbitrary stand-ins, since two of the tests below assert the
  // specific pair rather than just "some icon renders".
  const OPTIONS = [
    {
      id: "yes",
      label: "Yes",
      description: "Add CopilotKit to what you have",
      icon: Check,
    },
    {
      id: "no",
      label: "No",
      description: "Start from scratch",
      icon: X,
    },
  ];

  // The same guards every other option control in this wizard carries. They
  // live here because `ChoiceGrid` is a second implementation of that shared
  // treatment (see its header comment for why it cannot reuse `PickGrid`),
  // and a second implementation is exactly where the rules quietly drift.
  it("renders each option as a real button whose accessible name is its own visible text", () => {
    render(
      <ChoiceGrid options={OPTIONS} disabled={false} onSelect={vi.fn()} />,
    );

    // Anchored on the label, because the description is part of the name.
    const yes = screen.getByRole("button", { name: /^Yes/ });
    expect(yes.tagName).toBe("BUTTON");
    expect(yes.getAttribute("type")).toBe("button");
    expect(yes.getAttribute("aria-label")).toBeNull();
    expect(yes.textContent).toContain("Add CopilotKit to what you have");
  });

  // Two fixed-width centred columns, not two halves of the row. Stretched
  // across the full width the pair read as flat and adrift in a card this
  // tall, which is the thing this replaced; a later "simplify" back to
  // `sm:grid-cols-2` would quietly undo it.
  it("lays the options out as two narrow centred columns", () => {
    const { container } = render(
      <ChoiceGrid options={OPTIONS} disabled={false} onSelect={vi.fn()} />,
    );

    const grid = container.firstElementChild;
    expect(grid).not.toBeNull();
    expect(grid!.className).toMatch(/\bjustify-center\b/);
    expect(grid!.className).toMatch(
      /\bsm:grid-cols-\[repeat\(2,minmax\(0,12rem\)\)\]/,
    );
    // Full width below `sm`, so the narrowing is a wide-screen decision only.
    expect(grid!.className).toMatch(/\bgrid-cols-1\b/);
    expect(grid!.className).not.toMatch(/\bsm:grid-cols-2\b/);
  });

  it("marks only the selected option with aria-pressed", () => {
    render(
      <ChoiceGrid
        options={OPTIONS}
        selectedId="no"
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    const pressed = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]!.textContent).toContain("No");
  });

  // Dimming alone is not enough: without the real attribute a locked step's
  // options still take a click and still sit in the tab order.
  it("gives every option the real disabled attribute when the grid is disabled", () => {
    render(<ChoiceGrid options={OPTIONS} disabled onSelect={vi.fn()} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.className).toMatch(/\bdisabled:cursor-not-allowed\b/);
    }
  });

  it("shows a pointer cursor while enabled and calls onSelect with the option's id", () => {
    const onSelect = vi.fn();
    render(
      <ChoiceGrid options={OPTIONS} disabled={false} onSelect={onSelect} />,
    );

    const yes = screen.getByRole("button", { name: /^Yes/ });
    expect(yes.className).toMatch(/\bcursor-pointer\b/);
    fireEvent.click(yes);
    expect(onSelect).toHaveBeenCalledWith("yes");
  });

  // This only asserts an icon renders and is hidden from assistive
  // technology, not which icon it is — see the pair-specific test below for
  // that.
  it("renders each option's own icon, decorative and aria-hidden", () => {
    const { container } = render(
      <ChoiceGrid options={OPTIONS} disabled={false} onSelect={vi.fn()} />,
    );

    const icons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(icons).toHaveLength(2);
  });

  // The reader decided on a checkmark/cross pair, overriding the earlier
  // reasoning that ruled it out for reading as right-and-wrong. There is no
  // collision with a checkmark's other meaning in this wizard (marking a
  // *selected* `CapabilityGrid` tile): this step is single choice and shows
  // no selection checkmark of its own, asserted separately below. The
  // accent colour lives on the icon's bordered box (it reaches the svg via
  // `currentColor`), same shape as `CapabilityGrid`'s icon box in
  // `docs-map-parts.tsx` — this is one of the five mutation-checked guards,
  // dropping that class must make this fail.
  it("renders Yes's answer as a checkmark and No's as a cross, both in the accent colour", () => {
    render(
      <ChoiceGrid options={OPTIONS} disabled={false} onSelect={vi.fn()} />,
    );

    const yesButton = screen.getByRole("button", { name: /^Yes/ });
    const noButton = screen.getByRole("button", { name: /^No/ });

    const checkIcon = yesButton.querySelector("svg.lucide-check");
    const crossIcon = noButton.querySelector("svg.lucide-x");
    expect(checkIcon).not.toBeNull();
    expect(crossIcon).not.toBeNull();

    expect(checkIcon!.parentElement!.className).toContain(
      "text-[var(--accent)]",
    );
    expect(crossIcon!.parentElement!.className).toContain(
      "text-[var(--accent)]",
    );
  });

  // Single choice expresses selection purely through the accent border and
  // fill, same as `PickGrid` — a second, selection-only checkmark here would
  // collide with "yes"'s own icon, which is now literally a checkmark.
  // Asserting each button renders exactly one svg (its own icon) is what
  // catches a regression that adds that second icon back in.
  it("renders no selection checkmark on either option, even when one is selected", () => {
    render(
      <ChoiceGrid
        options={OPTIONS}
        selectedId="yes"
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    for (const button of screen.getAllByRole("button")) {
      expect(button.querySelectorAll("svg")).toHaveLength(1);
    }
  });

  // Guards the reversal back to the compact shape every other option tile in
  // the wizard uses — see this component's own header comment for the
  // trade. One of the five mutation-checked guards: putting the minimum
  // height back must make this fail.
  it("carries no minimum height on either option", () => {
    render(
      <ChoiceGrid options={OPTIONS} disabled={false} onSelect={vi.fn()} />,
    );

    for (const button of screen.getAllByRole("button")) {
      expect(button.className).not.toMatch(/\bmin-h-/);
    }
  });

  // The reader wants the icon on the same row as the label, with only the
  // description on its own line below — the same shape `CapabilityGrid`'s
  // tiles use. Assert this on DOM structure, not a class name: the element
  // that contains the label must not also contain the description — a
  // class-based assertion would pass against a layout that never actually
  // changed. Mirrors the equivalent `CapabilityGrid` assertion in
  // `docs-map-parts.test.tsx`. The other of the five mutation-checked
  // guards: moving the icon back above the label must make this fail.
  it("puts the icon and label on one row, with the description on its own line below", () => {
    render(
      <ChoiceGrid options={OPTIONS} disabled={false} onSelect={vi.fn()} />,
    );

    const yesButton = screen.getByRole("button", { name: /^Yes/ });
    const icon = yesButton.querySelector("svg.lucide-check");
    expect(icon).not.toBeNull();

    const label = screen.getByText("Yes");
    const description = screen.getByText("Add CopilotKit to what you have");

    // Walk up from the icon to find the row it shares with the label.
    let row: HTMLElement | null = icon!.parentElement;
    while (row && !row.contains(label)) {
      row = row.parentElement;
    }
    expect(row).not.toBeNull();
    expect(row!.contains(label)).toBe(true);
    expect(row!.contains(description)).toBe(false);
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

    // `fireEvent.click`'s default `detail` is 0 — the keyboard branch, so
    // `pointerActivated` is `false`. See the `pointerActivated` tests below
    // for the pointer branch.
    expect(onJump).toHaveBeenCalledExactlyOnceWith(1, false);
  });

  // The pointer branch — `setup-wizard.tsx` uses this to decide whether the
  // heading's focus ring should show once it lands there. A real pointer
  // click reports `event.detail > 0`; this drives that explicitly since a
  // plain `fireEvent.click` defaults to 0.
  it("passes pointerActivated=true when the click reports a non-zero detail", () => {
    const onJump = vi.fn();
    render(
      <WizardProgress steps={STEPS} current={3} furthest={3} onJump={onJump} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Your frontend/ }), {
      detail: 1,
    });

    expect(onJump).toHaveBeenCalledExactlyOnceWith(1, true);
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

  // The review step (step 4) passes no `onContinue` at all: the footer
  // should then render Back alone, with nothing where the primary used to
  // sit — not a disabled or hidden primary, no primary node whatsoever.
  // Asserting the total button count (rather than just querying for the
  // primary's absence by name) is what catches a mutation that keeps
  // rendering the primary with some other, still-truthy label.
  it("renders Back and no primary button when onContinue is absent", () => {
    render(<WizardNav onBack={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Back" })).not.toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
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

  // The pointer branch, same shape as `WizardProgress`'s own test above.
  it("passes pointerActivated=true to onBack when the click reports a non-zero detail", () => {
    const onBack = vi.fn();
    render(
      <WizardNav
        onBack={onBack}
        onContinue={vi.fn()}
        continueLabel="Continue"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }), {
      detail: 1,
    });

    expect(onBack).toHaveBeenCalledExactlyOnceWith(true);
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

    // `fireEvent.click`'s default `detail` is 0 — the keyboard branch, so
    // `pointerActivated` is `false`.
    expect(onContinue).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("passes pointerActivated=true to onContinue when the click reports a non-zero detail", () => {
    const onContinue = vi.fn();
    render(<WizardNav onContinue={onContinue} continueLabel="Continue" />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }), {
      detail: 1,
    });

    expect(onContinue).toHaveBeenCalledExactlyOnceWith(true);
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

  // The hint element must exist in the DOM whether or not `hint` is set —
  // this is what lets it clear/appear without reflowing the footer, since
  // there is never a moment it is mounted or unmounted. Asserting that the
  // *same node* persists across a hint appearing (rather than just "a
  // paragraph with this text exists" after the rerender) is what catches a
  // conditional-render regression: mutation (b) — rendering the hint only
  // when it is present — leaves it missing entirely on the first, hint-less
  // render, so the very first assertion below already fails.
  it("always renders the hint element, reserved whether or not hint is set", () => {
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

  // The hint used to sit on a row of its own below Back/Continue; it now
  // sits inside their own row, ordered between them, so the footer gets
  // equal breathing room above and below the button row instead of the
  // hint's line only ever adding weight underneath (see `WizardCard`'s
  // "equal top and bottom padding" test above for the other half of that).
  // Asserting the three share one parent — rather than just that the hint
  // exists somewhere in the tree — is what catches a regression back to a
  // second row: mutation (a) below reintroduces a wrapper around just the
  // buttons, which puts the hint one level outside it and fails this.
  it("keeps the hint as a sibling of Back and Continue in the same row, not a row beneath them", () => {
    render(
      <WizardNav
        onBack={vi.fn()}
        onContinue={vi.fn()}
        continueLabel="Continue"
        hint="Choose your frontend first"
      />,
    );

    const back = screen.getByRole("button", { name: "Back" });
    const primary = screen.getByRole("button", { name: "Continue" });
    const hintRow = document.querySelector('[aria-live="polite"]');
    expect(hintRow).not.toBeNull();

    expect(hintRow!.parentElement).toBe(back.parentElement);
    expect(hintRow!.parentElement).toBe(primary.parentElement);
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
