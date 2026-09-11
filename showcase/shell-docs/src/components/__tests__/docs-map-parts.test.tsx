// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CapabilityGrid,
  CapabilityIconMark,
  MapIntro,
  PickGrid,
  PickLogoMark,
} from "../docs-map-parts";
import type {
  LucideIconName,
  MapCapability,
  MapPick,
} from "@/lib/homepage-map";

afterEach(() => {
  cleanup();
});

// `CapabilityGrid`'s accessible name is title-followed-by-body, not the
// title alone (see the component's header comment), so a query by exact
// title would no longer match. Anchor on the title instead of matching it
// exactly.
function startsWithTitle(title: string): RegExp {
  return new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}

const PICKS: readonly MapPick[] = [
  { id: "vue", name: "Vue", logo: { kind: "frontend", icon: "vue" } },
  { id: "react", name: "React", logo: { kind: "frontend", icon: "react" } },
];

const PICKS_WITH_SUMMARY: readonly MapPick[] = [
  {
    id: "vue",
    name: "Vue",
    logo: { kind: "frontend", icon: "vue" },
    summary: "Vue 3 provider, composables, and chat primitives.",
  },
  {
    id: "react",
    name: "React",
    logo: { kind: "frontend", icon: "react" },
    summary: "The React provider, hooks, and UI components for CopilotKit.",
  },
];

const FRAMEWORK_PICKS: readonly MapPick[] = [
  {
    id: "langgraph-python",
    name: "LangGraph (Python)",
    logo: { kind: "framework", slug: "langgraph-python" },
  },
];

const CAPABILITIES: readonly MapCapability[] = [
  {
    id: "chat",
    title: "Chat surface",
    body: "Drop in a ready-made chat, sidebar, or popup.",
    icon: "MessageSquare",
  },
  {
    id: "gen-ui",
    title: "Generative UI",
    body: "Your agent returns real React components, not just text.",
    icon: "Paintbrush",
  },
];

describe("MapIntro", () => {
  it("renders the framing heading and paragraph", () => {
    const markup = renderToStaticMarkup(
      <MapIntro heading="Set up CopilotKit" body="One paragraph." />,
    );

    expect(markup).toMatch(/<h2[^>]*>Set up CopilotKit<\/h2>/);
    expect(markup).toContain("One paragraph.");
  });

  // The intro frames the wizard the same way the video and backend-grid
  // headings frame their own sections; the wizard card underneath it is a
  // different matter (see the guard below and the comment on MapIntro
  // itself).
  it("centres the heading and body", () => {
    const markup = renderToStaticMarkup(
      <MapIntro heading="Set up CopilotKit" body="One paragraph." />,
    );

    expect(markup).toContain("text-center");
    expect(markup).toContain("items-center");
  });
});

// The wizard's own step content — its option tiles — must not pick up the
// centring added to MapIntro above it. This is the guard that actually
// matters: an over-centred card is the likely regression, and nothing in
// the "things that should centre" tests would ever catch it.
describe("wizard card content stays left-aligned", () => {
  it("keeps PickGrid's option buttons left-aligned", () => {
    render(<PickGrid picks={PICKS} disabled={false} onSelect={vi.fn()} />);

    for (const pick of PICKS) {
      const button = screen.getByRole("button", { name: pick.name });
      expect(button.className).toContain("text-left");
      expect(button.className).not.toContain("text-center");
    }
  });

  it("keeps CapabilityGrid's option buttons left-aligned", () => {
    render(
      <CapabilityGrid
        capabilities={CAPABILITIES}
        selectedIds={[]}
        disabled={false}
        onToggle={vi.fn()}
      />,
    );

    for (const capability of CAPABILITIES) {
      const button = screen.getByRole("button", {
        name: startsWithTitle(capability.title),
      });
      expect(button.className).toContain("text-left");
      expect(button.className).not.toContain("text-center");
    }
  });
});

describe("PickGrid", () => {
  it("renders every option as a real, enabled button", () => {
    render(<PickGrid picks={PICKS} disabled={false} onSelect={vi.fn()} />);

    for (const pick of PICKS) {
      const button = screen.getByRole("button", {
        name: pick.name,
      }) as HTMLButtonElement;
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      expect(button.disabled).toBe(false);
    }
  });

  // Dimming alone would leave a locked step's options clickable and
  // reachable by Tab — the real `disabled` attribute is what takes them out
  // of the interaction entirely. Guards against dropping the attribute
  // while keeping only a dimming class.
  it("puts the real disabled attribute on every option when disabled", () => {
    render(<PickGrid picks={PICKS} disabled={true} onSelect={vi.fn()} />);

    for (const pick of PICKS) {
      const button = screen.getByRole("button", {
        name: pick.name,
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  });

  it("marks exactly the selected option aria-pressed=true and every other false", () => {
    render(
      <PickGrid
        picks={PICKS}
        selectedId="vue"
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Vue" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "React" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  // A single choice does not need to also announce itself with a checkmark
  // — the accent ring and fill already carry it. Guards against a mutation
  // that added one anyway.
  it("renders no checkmark on a selected option", () => {
    render(
      <PickGrid
        picks={PICKS}
        selectedId="vue"
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Vue" });
    expect(button.querySelector("svg.lucide-check")).toBeNull();
  });

  // Tailwind v4 no longer gives `<button>` a pointer cursor by default, so
  // this has to be requested explicitly. Guards against the class being
  // dropped.
  it("shows a pointer cursor on an enabled option", () => {
    render(<PickGrid picks={PICKS} disabled={false} onSelect={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Vue" });
    expect(button.className).toContain("cursor-pointer");
  });

  // A disabled option must not invite a click it will ignore. This
  // implementation pairs the plain `cursor-pointer` with a `disabled:`
  // variant that sets `cursor-not-allowed` — a Tailwind `:disabled`
  // pseudo-class selector outranks a plain class in specificity, so the
  // not-allowed cursor wins whenever the button is actually disabled.
  // Guards against that pairing being dropped, which would leave
  // `cursor-pointer` applying unconditionally.
  it("pairs the pointer cursor with a not-allowed cursor for disabled options", () => {
    render(<PickGrid picks={PICKS} disabled={true} onSelect={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Vue" });
    expect(button.className).toContain("disabled:cursor-not-allowed");
  });

  it("calls onSelect with the clicked pick's id", () => {
    const onSelect = vi.fn();
    render(<PickGrid picks={PICKS} disabled={false} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "React" }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("react");
  });

  it("does not call onSelect when the grid is disabled", () => {
    const onSelect = vi.fn();
    render(<PickGrid picks={PICKS} disabled={true} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "React" }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("gives each option its visible name as its accessible name, with no shadowing aria-label", () => {
    render(<PickGrid picks={PICKS} disabled={false} onSelect={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Vue" });
    expect(button.hasAttribute("aria-label")).toBe(false);
  });

  // No `size` prop at all must render the same as today's only behaviour —
  // asserted independently of the "compact" tests below, so a change of
  // default is caught even if every explicit-"compact" call site is fine.
  it("renders the compact treatment when no size prop is given", () => {
    render(
      <PickGrid
        picks={PICKS_WITH_SUMMARY}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.queryByText(PICKS_WITH_SUMMARY[0]!.summary!)).toBeNull();
  });

  it('renders no summary text in "compact" size', () => {
    render(
      <PickGrid
        picks={PICKS_WITH_SUMMARY}
        disabled={false}
        onSelect={vi.fn()}
        size="compact"
      />,
    );

    for (const pick of PICKS_WITH_SUMMARY) {
      expect(screen.queryByText(pick.summary!)).toBeNull();
    }
  });

  it('renders each pick\'s summary text in "card" size', () => {
    render(
      <PickGrid
        picks={PICKS_WITH_SUMMARY}
        disabled={false}
        onSelect={vi.fn()}
        size="card"
      />,
    );

    for (const pick of PICKS_WITH_SUMMARY) {
      expect(screen.getByText(pick.summary!)).not.toBeNull();
    }
  });

  // A pick with no summary must not leave an empty element where the
  // summary would otherwise sit.
  it('renders no empty summary element in "card" size when a pick has none', () => {
    render(
      <PickGrid
        picks={PICKS}
        disabled={false}
        onSelect={vi.fn()}
        size="card"
      />,
    );

    const button = screen.getByRole("button", { name: "Vue" });
    // The button's only text is the name — no stray empty <span> sibling
    // left over from a summary that was never provided.
    expect(button.textContent).toBe("Vue");
  });

  // The reader wants the logo and name on one row, like `CapabilityGrid`'s
  // tiles, with only the summary on its own line below. Assert this on DOM
  // structure, not a class name: the element that contains the name must
  // not also contain the summary — a class-based assertion would pass
  // against a layout that never actually changed. Mirrors the equivalent
  // `CapabilityGrid` assertion below.
  it('puts the logo and name on one row, with the summary on its own line below in "card" size', () => {
    render(
      <PickGrid
        picks={PICKS_WITH_SUMMARY}
        disabled={false}
        onSelect={vi.fn()}
        size="card"
      />,
    );

    // The accessible name now includes the summary too, same as
    // `CapabilityGrid`'s title-plus-body buttons — so find the button via
    // its name text rather than an exact-name role query.
    const name = screen.getByText("Vue");
    const button = name.closest("button");
    expect(button).not.toBeNull();
    const summary = screen.getByText(PICKS_WITH_SUMMARY[0]!.summary!);

    const logo = button!.querySelector("svg");
    expect(logo).not.toBeNull();

    // Walk up from the logo to find the row it shares with the name, same
    // shape as the icon-to-title walk in the `CapabilityGrid` test below.
    let row: HTMLElement | null = logo!.parentElement;
    while (row && !row.contains(name)) {
      row = row.parentElement;
    }
    expect(row).not.toBeNull();
    expect(row!.contains(name)).toBe(true);
    expect(row!.contains(summary)).toBe(false);
  });

  // The nineteen agent-backend logos must read as the same blue-violet as
  // the docs' own framework selector, which renders the identical
  // `FrameworkLogo` with `text-[var(--accent)]` (see
  // `framework-selector.tsx`). Assert both halves so swapping one token for
  // an unrelated one still fails: the accent class must be present, and the
  // old `--text-secondary` treatment must be gone, not just supplemented.
  it("gives a framework-backed pick's logo the accent colour, not text-secondary", () => {
    render(
      <PickGrid picks={FRAMEWORK_PICKS} disabled={false} onSelect={vi.fn()} />,
    );

    const button = screen.getByRole("button", {
      name: FRAMEWORK_PICKS[0]!.name,
    });
    const logo = button.querySelector("svg");
    expect(logo).not.toBeNull();
    expect(logo!.getAttribute("class")).toContain("text-[var(--accent)]");
    expect(logo!.getAttribute("class")).not.toContain(
      "text-[var(--text-secondary)]",
    );
  });
});

describe("CapabilityGrid", () => {
  it("renders every option as a real, enabled button", () => {
    render(
      <CapabilityGrid
        capabilities={CAPABILITIES}
        selectedIds={[]}
        disabled={false}
        onToggle={vi.fn()}
      />,
    );

    for (const capability of CAPABILITIES) {
      const button = screen.getByRole("button", {
        name: startsWithTitle(capability.title),
      }) as HTMLButtonElement;
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("puts the real disabled attribute on every option when disabled", () => {
    render(
      <CapabilityGrid
        capabilities={CAPABILITIES}
        selectedIds={[]}
        disabled={true}
        onToggle={vi.fn()}
      />,
    );

    for (const capability of CAPABILITIES) {
      const button = screen.getByRole("button", {
        name: startsWithTitle(capability.title),
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  });

  it("marks every id in selectedIds and no others", () => {
    render(
      <CapabilityGrid
        capabilities={CAPABILITIES}
        selectedIds={["chat"]}
        disabled={false}
        onToggle={vi.fn()}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: startsWithTitle("Chat surface") })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: startsWithTitle("Generative UI") })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  // A toggle needs to show its own state — the checkmark is the thing that
  // distinguishes this grid from `PickGrid`'s bare accent treatment. Guards
  // against a mutation that removed it, or added it unconditionally.
  it("renders a checkmark on a selected option and not on an unselected one", () => {
    render(
      <CapabilityGrid
        capabilities={CAPABILITIES}
        selectedIds={["chat"]}
        disabled={false}
        onToggle={vi.fn()}
      />,
    );

    const selected = screen.getByRole("button", {
      name: startsWithTitle("Chat surface"),
    });
    const unselected = screen.getByRole("button", {
      name: startsWithTitle("Generative UI"),
    });
    expect(selected.querySelector("svg.lucide-check")).not.toBeNull();
    expect(unselected.querySelector("svg.lucide-check")).toBeNull();
  });

  // Tailwind v4 no longer gives `<button>` a pointer cursor by default, so
  // this has to be requested explicitly. Guards against the class being
  // dropped.
  it("shows a pointer cursor on an enabled option", () => {
    render(
      <CapabilityGrid
        capabilities={CAPABILITIES}
        selectedIds={[]}
        disabled={false}
        onToggle={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", {
      name: startsWithTitle("Chat surface"),
    });
    expect(button.className).toContain("cursor-pointer");
  });

  // Same pairing as `PickGrid`: a `disabled:` variant selector outranks the
  // plain `cursor-pointer` class in specificity, so a disabled option reads
  // as not-allowed rather than clickable. Guards against that pairing being
  // dropped, which would leave `cursor-pointer` applying unconditionally.
  it("pairs the pointer cursor with a not-allowed cursor for disabled options", () => {
    render(
      <CapabilityGrid
        capabilities={CAPABILITIES}
        selectedIds={[]}
        disabled={true}
        onToggle={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", {
      name: startsWithTitle("Chat surface"),
    });
    expect(button.className).toContain("disabled:cursor-not-allowed");
  });

  // The reader wants the title on the same row as the icon, with only the
  // body on its own line below. Assert this on DOM structure, not a class
  // name: the icon's nearest ancestor that also holds the title text must
  // not also hold the body text — a class-name assertion would pass even if
  // the layout itself were never actually changed.
  it("puts the icon and title on one row, with the body on its own line below", () => {
    render(
      <CapabilityGrid
        capabilities={CAPABILITIES}
        selectedIds={[]}
        disabled={false}
        onToggle={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", {
      name: startsWithTitle("Chat surface"),
    });
    const icon = button.querySelector("svg.lucide-message-square");
    expect(icon).not.toBeNull();

    const title = screen.getByText("Chat surface");
    const body = screen.getByText(CAPABILITIES[0]!.body);

    // Walk up from the icon to find the row it shares with the title.
    let row: HTMLElement | null = icon!.parentElement;
    while (row && !row.contains(title)) {
      row = row.parentElement;
    }
    expect(row).not.toBeNull();
    expect(row!.contains(title)).toBe(true);
    expect(row!.contains(body)).toBe(false);
  });

  it("calls onToggle with the clicked option's id", () => {
    const onToggle = vi.fn();
    render(
      <CapabilityGrid
        capabilities={CAPABILITIES}
        selectedIds={[]}
        disabled={false}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: startsWithTitle("Generative UI") }),
    );

    expect(onToggle).toHaveBeenCalledExactlyOnceWith("gen-ui");
  });

  it("does not call onToggle when the grid is disabled", () => {
    const onToggle = vi.fn();
    render(
      <CapabilityGrid
        capabilities={CAPABILITIES}
        selectedIds={[]}
        disabled={true}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: startsWithTitle("Generative UI") }),
    );

    expect(onToggle).not.toHaveBeenCalled();
  });

  // The contract's own item 4 is amended here: this grid's accessible name
  // must *contain* the title (never be shadowed by an aria-label that
  // replaces it), but need not equal the title exactly — the body is part
  // of the button's visible text too, same as any toggle carrying a
  // heading and a description.
  it("gives each option an accessible name containing its title, with no shadowing aria-label", () => {
    render(
      <CapabilityGrid
        capabilities={CAPABILITIES}
        selectedIds={[]}
        disabled={false}
        onToggle={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", {
      name: startsWithTitle("Chat surface"),
    });
    expect(button.hasAttribute("aria-label")).toBe(false);
  });

  // The body is the whole reason these tiles are readable — the six titles
  // alone are bare phrases nobody could choose between. A future change
  // that silently dropped it must fail here.
  it("renders each capability's body text", () => {
    render(
      <CapabilityGrid
        capabilities={CAPABILITIES}
        selectedIds={[]}
        disabled={false}
        onToggle={vi.fn()}
      />,
    );

    for (const capability of CAPABILITIES) {
      expect(screen.getByText(capability.body)).not.toBeNull();
    }
  });
});

describe("PickLogoMark", () => {
  // `react` is a bundled `FrontendLogo` icon that sets an explicit `color`
  // (see `FRONTEND_ICONS` in `frontend-logo.tsx`) — a marker no framework
  // logo carries, so its presence proves the "frontend" branch actually ran
  // rather than just proving *some* svg rendered.
  it("renders the frontend logo for a frontend pick", () => {
    const { container } = render(
      <PickLogoMark logo={{ kind: "frontend", icon: "react" }} />,
    );

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("color")).toBe("#61DAFB");
  });

  // An unregistered slug with a `fallbackSrc` forces `FrameworkLogo` down
  // its `<img>` fallback branch — a shape `FrontendLogo` never produces —
  // so this proves the "framework" branch actually ran.
  it("renders the framework logo for a framework pick", () => {
    const { container } = render(
      <PickLogoMark
        logo={{
          kind: "framework",
          slug: "not-a-real-slug",
          fallbackSrc: "/fallback.png",
        }}
      />,
    );

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("/fallback.png");
  });
});

describe("CapabilityIconMark", () => {
  // Driven off `LucideIconName` itself, not a hand-copied list: `satisfies
  // Record<LucideIconName, true>` fails to compile if this object is
  // missing a member the type allows or carries one it doesn't, so a new
  // icon name that nobody wired up here fails at build time rather than
  // only surfacing as a runtime crash the first time someone picks it.
  const ALL_ICON_NAMES = Object.keys({
    MessageSquare: true,
    Paintbrush: true,
    User: true,
    Settings: true,
    Repeat: true,
    Wrench: true,
  } satisfies Record<LucideIconName, true>) as LucideIconName[];

  it("renders an icon for every LucideIconName the type allows", () => {
    for (const icon of ALL_ICON_NAMES) {
      const { container } = render(<CapabilityIconMark icon={icon} />);
      expect(container.querySelector("svg")).not.toBeNull();
      cleanup();
    }
  });
});
