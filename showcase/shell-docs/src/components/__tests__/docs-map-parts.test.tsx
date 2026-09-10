// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CapabilityGrid, MapIntro, PickGrid } from "../docs-map-parts";
import type { MapCapability, MapPick } from "@/lib/homepage-map";

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
