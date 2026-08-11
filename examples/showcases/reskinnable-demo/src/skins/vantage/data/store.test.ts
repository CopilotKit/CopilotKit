import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { DEFAULT_LENS } from "./lens";

const newBoard = (title: string) => ({
  title,
  summary: "generated in a test",
  lens: DEFAULT_LENS,
  tiles: [{ kind: "kpi" as const, metric: "arr" as const, label: "ARR" }],
});

describe("vantage store", () => {
  beforeEach(() => store.reset());

  it("starts from seed with one pinned board", () => {
    expect(store.boards().filter((b) => b.pinned)).toHaveLength(1);
  });

  it("files a new board as generated, unpinned, with a slug", () => {
    const board = store.addBoard(newBoard("Monday exec review"));
    expect(board.origin).toBe("generated");
    expect(board.pinned).toBe(false);
    expect(board.slug).toBe("monday-exec-review");
    expect(store.findBoard(board.id)).toEqual(board);
    expect(store.findBoard(board.slug)).toEqual(board);
  });

  it("uniquifies a colliding slug rather than overwriting the existing board", () => {
    const a = store.addBoard(newBoard("Executive review")); // collides with seed
    expect(a.slug).not.toBe("exec-review");
    const b = store.addBoard(newBoard("Executive review"));
    expect(b.slug).not.toBe(a.slug);
  });

  it("pinning a board unpins the previous one — exactly one board is ever pinned", () => {
    const board = store.addBoard(newBoard("New pin"));
    store.patchBoard(board.id, { pinned: true });
    expect(
      store
        .boards()
        .filter((b) => b.pinned)
        .map((b) => b.id),
    ).toEqual([board.id]);
  });

  it("appends notes without dropping existing ones", () => {
    const board = store.addBoard({ ...newBoard("Noted"), notes: ["first"] });
    store.patchBoard(board.id, { notes: [...board.notes, "second"] });
    expect(store.findBoard(board.id)!.notes).toEqual(["first", "second"]);
  });

  it("records a connected source", () => {
    const before = store.sources().length;
    const source = store.addSource({
      name: "GROWTH_PROD",
      warehouse: "BigQuery",
    });
    expect(store.sources()).toHaveLength(before + 1);
    expect(source.tableCount).toBeGreaterThan(0);
  });

  it("reset discards every mutation and restores the seed", () => {
    store.addBoard(newBoard("Throwaway"));
    store.addSource({ name: "TEMP", warehouse: "Snowflake" });
    const boardCount = store.boards().length;
    store.reset();
    expect(store.boards().length).toBeLessThan(boardCount);
    expect(store.sources()).toHaveLength(1);
  });

  it("does not let a mutation bleed back into the imported seed JSON", () => {
    store.addBoard(newBoard("Isolation check"));
    store.reset();
    expect(store.boards().some((b) => b.title === "Isolation check")).toBe(
      false,
    );
  });
});
