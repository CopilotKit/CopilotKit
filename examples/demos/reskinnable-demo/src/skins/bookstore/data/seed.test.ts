// src/skins/bookstore/data/seed.test.ts
import { describe, expect, it } from "vitest";
import { BOOKSTORE_BOOKS } from "./seed";
import type { Genre } from "./types";

const PREFERRED: Genre[] = ["literary", "translated"];
const preferred = () =>
  BOOKSTORE_BOOKS.filter((b) => PREFERRED.includes(b.genre));

describe("BOOKSTORE_BOOKS", () => {
  it("holds exactly 25 books", () => {
    expect(BOOKSTORE_BOOKS).toHaveLength(25);
  });

  it("has unique ids and unique slugs", () => {
    expect(new Set(BOOKSTORE_BOOKS.map((b) => b.id)).size).toBe(25);
    expect(new Set(BOOKSTORE_BOOKS.map((b) => b.slug)).size).toBe(25);
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

describe("the club's edition pair", () => {
  const pair = BOOKSTORE_BOOKS.filter((b) => b.workId === "trust");

  it("has exactly two editions of the club pick", () => {
    expect(pair).toHaveLength(2);
  });

  it("covers a hardcover and a paperback of the same title", () => {
    expect(pair.map((b) => b.format).sort()).toEqual([
      "hardcover",
      "paperback",
    ]);
    expect(new Set(pair.map((b) => b.title)).size).toBe(1);
  });

  it("prices the paperback below the hardcover, so the swap visibly saves money", () => {
    const hard = pair.find((b) => b.format === "hardcover")!;
    const soft = pair.find((b) => b.format === "paperback")!;
    expect(soft.priceCents).toBeLessThan(hard.priceCents);
  });

  it("keeps the paperback under Maya's $20 cap and the hardcover over it", () => {
    const hard = pair.find((b) => b.format === "hardcover")!;
    const soft = pair.find((b) => b.format === "paperback")!;
    expect(hard.priceCents).toBeGreaterThan(2000);
    expect(soft.priceCents).toBeLessThanOrEqual(2000);
  });

  it("leaves every other book without a workId", () => {
    expect(BOOKSTORE_BOOKS.filter((b) => b.workId !== undefined)).toHaveLength(
      2,
    );
  });
});
