// src/skins/bookstore/components/filter-bar.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FilterBar } from "./filter-bar";
import {
  BOOK_GENRES,
  BOOK_SORTS,
  GENRE_LABELS,
  SORT_LABELS,
} from "../data/query";

const activeLabels = () =>
  Array.from(document.querySelectorAll('[data-active="true"]')).map(
    (el) => el.textContent,
  );

describe("FilterBar", () => {
  it("marks nothing active for an empty query", () => {
    render(<FilterBar query={{}} onChange={vi.fn()} />);
    expect(activeLabels()).toEqual([]);
  });

  it("marks the genre lever active", () => {
    render(<FilterBar query={{ genre: "scifi" }} onChange={vi.fn()} />);
    expect(activeLabels()).toContain("Science fiction");
  });

  it("marks the format lever active", () => {
    render(<FilterBar query={{ format: "paperback" }} onChange={vi.fn()} />);
    expect(activeLabels()).toContain("Paperback");
  });

  it("marks the price cap active", () => {
    render(<FilterBar query={{ maxCents: 2000 }} onChange={vi.fn()} />);
    expect(activeLabels()).toContain("Under $20");
  });

  it("marks the sort active", () => {
    render(<FilterBar query={{ sort: "price_asc" }} onChange={vi.fn()} />);
    expect(activeLabels()).toContain("Price, low to high");
  });

  it("marks all three levers of the beat-3c query at once", () => {
    render(
      <FilterBar
        query={{ genre: "scifi", format: "paperback", sort: "price_asc" }}
        onChange={vi.fn()}
      />,
    );
    // The whole point of the beat: the audience sees the agent set the controls.
    expect(activeLabels()).toEqual(
      expect.arrayContaining([
        "Science fiction",
        "Paperback",
        "Price, low to high",
      ]),
    );
  });

  it("carries the brand tint on an active control and not on an inactive one", () => {
    render(<FilterBar query={{ genre: "scifi" }} onChange={vi.fn()} />);
    const active = screen.getByText("Science fiction");
    const inactive = screen.getByText("Poetry");
    expect(active.className).toContain("bg-brand-soft");
    expect(inactive.className).not.toContain("bg-brand-soft");
  });

  it("reports a lever change as a merged query", () => {
    const onChange = vi.fn();
    render(<FilterBar query={{ genre: "scifi" }} onChange={onChange} />);
    screen.getByText("Paperback").click();
    expect(onChange).toHaveBeenCalledWith({
      genre: "scifi",
      format: "paperback",
    });
  });

  it("toggles a lever off when the active one is clicked again", () => {
    const onChange = vi.fn();
    render(<FilterBar query={{ genre: "scifi" }} onChange={onChange} />);
    screen.getByText("Science fiction").click();
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("keeps its genre and sort vocabulary total against the label maps", () => {
    // BOOK_GENRES/BOOK_SORTS are typed `readonly Genre[]`/`readonly SortKey[]`,
    // so TypeScript does not check them for totality against the union type —
    // a 7th Genre would compile while the filter bar silently lost the option.
    // GENRE_LABELS/SORT_LABELS are Record-typed and ARE compiler-checked, so
    // comparing the arrays against those keys closes the gap at test time.
    expect([...BOOK_GENRES].sort()).toEqual(Object.keys(GENRE_LABELS).sort());
    expect([...BOOK_SORTS].sort()).toEqual(Object.keys(SORT_LABELS).sort());
  });
});
