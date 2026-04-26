/**
 * Unit tests for ChipsExplainer — collapsible "What do these chips mean?"
 * panel on the Cells tab.
 *
 * Covers:
 *   - default-collapsed render (panel content hidden)
 *   - click toggles expanded; aria-expanded flips
 *   - click again collapses
 *   - "More detail →" link wires href + target=_blank + rel=noopener noreferrer
 *   - localStorage persistence via key "chip-explainer-open"
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ChipsExplainer } from "./chips-explainer";

const NOTION_URL =
  "https://www.notion.so/copilotkit/34e3aa38185281d7bf2ac3ea9d474b36";

const storageMap = new Map<string, string>();

beforeEach(() => {
  storageMap.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => storageMap.set(key, value),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
    get length() {
      return storageMap.size;
    },
    key: () => null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChipsExplainer — default collapsed", () => {
  it("renders the disclosure trigger with aria-expanded=false by default", () => {
    const { getByRole } = render(<ChipsExplainer />);
    const button = getByRole("button", { name: /what do these chips mean/i });
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not render the panel content when collapsed", () => {
    const { queryByTestId } = render(<ChipsExplainer />);
    const panel = queryByTestId("chips-explainer-panel");
    // Either not in DOM, or rendered but hidden (aria-hidden / hidden attr).
    if (panel) {
      const isHidden =
        panel.hasAttribute("hidden") ||
        panel.getAttribute("aria-hidden") === "true";
      expect(isHidden).toBe(true);
    } else {
      expect(panel).toBeNull();
    }
  });
});

describe("ChipsExplainer — toggle behavior", () => {
  it("clicking the trigger expands the panel and flips aria-expanded", () => {
    const { getByRole, getByTestId } = render(<ChipsExplainer />);
    const button = getByRole("button", { name: /what do these chips mean/i });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const panel = getByTestId("chips-explainer-panel");
    expect(panel).toBeTruthy();
    expect(panel.hasAttribute("hidden")).toBe(false);
    expect(panel.getAttribute("aria-hidden")).not.toBe("true");
  });

  it("clicking again collapses the panel", () => {
    const { getByRole, queryByTestId } = render(<ChipsExplainer />);
    const button = getByRole("button", { name: /what do these chips mean/i });
    fireEvent.click(button); // expand
    fireEvent.click(button); // collapse
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const panel = queryByTestId("chips-explainer-panel");
    if (panel) {
      const isHidden =
        panel.hasAttribute("hidden") ||
        panel.getAttribute("aria-hidden") === "true";
      expect(isHidden).toBe(true);
    } else {
      expect(panel).toBeNull();
    }
  });

  it("aria-controls on the trigger references the panel id", () => {
    const { getByRole, getByTestId } = render(<ChipsExplainer />);
    const button = getByRole("button", { name: /what do these chips mean/i });
    fireEvent.click(button);
    const panel = getByTestId("chips-explainer-panel");
    const controls = button.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(panel.id).toBe(controls);
  });
});

describe("ChipsExplainer — More detail link", () => {
  it('links to the Notion plain-English page with target=_blank and rel="noopener noreferrer"', () => {
    const { getByRole } = render(<ChipsExplainer />);
    const button = getByRole("button", { name: /what do these chips mean/i });
    fireEvent.click(button);
    const link = getByRole("link", {
      name: /more detail/i,
    }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(NOTION_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("ChipsExplainer — localStorage persistence", () => {
  it('renders expanded on mount when localStorage["chip-explainer-open"] === "true"', () => {
    storageMap.set("chip-explainer-open", "true");
    const { getByRole, getByTestId } = render(<ChipsExplainer />);
    const button = getByRole("button", { name: /what do these chips mean/i });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(getByTestId("chips-explainer-panel")).toBeTruthy();
  });

  it("writes the open state to localStorage on toggle", () => {
    const { getByRole } = render(<ChipsExplainer />);
    const button = getByRole("button", { name: /what do these chips mean/i });
    fireEvent.click(button); // expand
    expect(storageMap.get("chip-explainer-open")).toBe("true");
    fireEvent.click(button); // collapse
    expect(storageMap.get("chip-explainer-open")).toBe("false");
  });
});

describe("ChipsExplainer — content", () => {
  it("renders bullets for D0 through D6 when expanded", () => {
    const { getByRole, getByTestId } = render(<ChipsExplainer />);
    const button = getByRole("button", { name: /what do these chips mean/i });
    fireEvent.click(button);
    const panel = getByTestId("chips-explainer-panel");
    const text = panel.textContent ?? "";
    for (const layer of ["D0", "D1", "D2", "D3", "D4", "D5", "D6"]) {
      expect(text).toContain(layer);
    }
  });
});
