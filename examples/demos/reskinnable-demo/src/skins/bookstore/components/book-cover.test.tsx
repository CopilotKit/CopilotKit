// src/skins/bookstore/components/book-cover.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BOOKSTORE_BOOKS } from "../data/seed";
import { BookCover, COVER_TINTS } from "./book-cover";

const book = (slug: string) => {
  const found = BOOKSTORE_BOOKS.find((b) => b.slug === slug);
  if (!found) throw new Error(`no seed book ${slug}`);
  return found;
};

describe("BookCover", () => {
  it("ships a six-stop tint ramp, matching the seed's spineTint range", () => {
    expect(COVER_TINTS).toHaveLength(6);
  });

  it("sets the title and author as text, not as an image", () => {
    render(<BookCover book={book("kairos")} />);
    expect(screen.getByText("Kairos")).toBeTruthy();
    expect(screen.getByText("Jenny Erpenbeck")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("labels the whole cover for assistive tech", () => {
    render(<BookCover book={book("kairos")} />);
    expect(
      screen.getByRole("img", { name: /Kairos by Jenny Erpenbeck/i }),
    ).toBeTruthy();
  });

  it("renders every seed book without throwing", () => {
    for (const b of BOOKSTORE_BOOKS) {
      const { unmount } = render(<BookCover book={b} />);
      unmount();
    }
  });

  it("shrinks the type for a long title", () => {
    const { container: long } = render(
      <BookCover book={book("small-things-like-these")} />,
    );
    const { container: short } = render(<BookCover book={book("trust")} />);
    const size = (el: Element | null) =>
      Number((el as HTMLElement).dataset.titleSize);
    expect(size(long.querySelector("[data-title-size]"))).toBeLessThan(
      size(short.querySelector("[data-title-size]")),
    );
  });

  it("falls back to the first tint when spineTint is out of range", () => {
    const { container } = render(
      <BookCover book={{ ...book("trust"), spineTint: 99 }} />,
    );
    expect((container.firstElementChild as HTMLElement).dataset.tint).toBe("0");
  });
});
