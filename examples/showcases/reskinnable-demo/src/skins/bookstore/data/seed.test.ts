// src/skins/bookstore/data/seed.test.ts
import { describe, expect, it } from "vitest";
import { BOOKSTORE_BOOKS } from "./seed";
import type { Genre } from "./types";

const PREFERRED: Genre[] = ["literary", "translated"];
const preferred = () =>
  BOOKSTORE_BOOKS.filter((b) => PREFERRED.includes(b.genre));

describe("BOOKSTORE_BOOKS", () => {
  it("holds exactly 24 books", () => {
    expect(BOOKSTORE_BOOKS).toHaveLength(24);
  });

  it("has unique ids and unique slugs", () => {
    expect(new Set(BOOKSTORE_BOOKS.map((b) => b.id)).size).toBe(24);
    expect(new Set(BOOKSTORE_BOOKS.map((b) => b.slug)).size).toBe(24);
  });

  it("prices everything in whole cents above zero", () => {
    for (const b of BOOKSTORE_BOOKS) {
      expect(Number.isInteger(b.priceCents)).toBe(true);
      expect(b.priceCents).toBeGreaterThan(0);
    }
  });

  it("keeps spineTint inside the six-stop ramp", () => {
    for (const b of BOOKSTORE_BOOKS) {
      expect(b.spineTint).toBeGreaterThanOrEqual(0);
      expect(b.spineTint).toBeLessThanOrEqual(5);
    }
  });

  it("names a translator on every translated title", () => {
    for (const b of BOOKSTORE_BOOKS.filter((x) => x.genre === "translated")) {
      expect(b.translator, `${b.title} needs a translator`).toBeTruthy();
    }
  });

  // ── The beat-4 falsifiability rule (spec §4.1) ────────────────────────────
  it("carries at least 3 hardcovers in the preferred genres", () => {
    expect(
      preferred().filter((b) => b.format === "hardcover").length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("carries at least 3 over-$20 titles in the preferred genres", () => {
    expect(
      preferred().filter((b) => b.priceCents > 2000).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("carries at least one title that is BOTH hardcover and over $20", () => {
    expect(
      preferred().filter((b) => b.format === "hardcover" && b.priceCents > 2000)
        .length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("flags at least 3 translated titles as New & Notable, for pill 1", () => {
    expect(
      BOOKSTORE_BOOKS.filter((b) => b.genre === "translated" && b.isNew).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("leaves at least 3 sci-fi paperbacks for the beat-3c levers pill", () => {
    expect(
      BOOKSTORE_BOOKS.filter(
        (b) => b.genre === "scifi" && b.format === "paperback",
      ).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("includes a sci-fi hardcover, so the format lever visibly excludes something", () => {
    expect(
      BOOKSTORE_BOOKS.some(
        (b) => b.genre === "scifi" && b.format === "hardcover",
      ),
    ).toBe(true);
  });
});
