import { describe, expect, it } from "vitest";
import {
  ɵclampSlashIndex,
  ɵfilterCommands,
  ɵflattenCommandItems,
  ɵnextSlashIndex,
  ɵparseSlashQuery,
  ɵresolveSlashKey,
} from "../composer";

interface MenuItem {
  label: string;
  action?: () => void;
  items?: (MenuItem | "-")[];
}

const noop = () => {};

function command(label: string): MenuItem {
  return { label, action: noop };
}

function labels(items: readonly { label: string }[]) {
  return items.map((item) => item.label);
}

describe("ɵflattenCommandItems", () => {
  it("opens groups, drops separators, and keeps menu order", () => {
    const menu: (MenuItem | "-")[] = [
      command("Attach"),
      "-",
      {
        label: "More",
        items: [
          command("Summarize"),
          "-",
          { label: "Deep", items: [command("Translate")] },
        ],
      },
    ];
    expect(labels(ɵflattenCommandItems(menu))).toEqual([
      "Attach",
      "Summarize",
      "Translate",
    ]);
  });

  it("keeps only the first item with a label", () => {
    const first = command("Attach");
    const result = ɵflattenCommandItems([first, command("Attach")]);
    expect(result).toEqual([first]);
  });

  it("skips leaf items without an action, such as an empty group", () => {
    const menu: (MenuItem | "-")[] = [
      { label: "Empty group", items: [] },
      { label: "No action" },
      command("Run"),
    ];
    expect(labels(ɵflattenCommandItems(menu))).toEqual(["Run"]);
  });
});

describe("ɵfilterCommands", () => {
  const commands = [
    command("Translate"),
    command("Summarize"),
    command("Sum up"),
  ];

  it("returns nothing while the menu is closed", () => {
    expect(ɵfilterCommands(commands, null)).toEqual([]);
  });

  it("returns every command for an empty or blank query", () => {
    expect(labels(ɵfilterCommands(commands, "  "))).toEqual([
      "Translate",
      "Summarize",
      "Sum up",
    ]);
  });

  it("ranks prefix matches before substring matches, ignoring case", () => {
    const pool = [command("Resume"), command("Summarize"), command("Sum up")];
    expect(labels(ɵfilterCommands(pool, " SUM"))).toEqual([
      "Summarize",
      "Sum up",
      "Resume",
    ]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(ɵfilterCommands(commands, "zzz")).toEqual([]);
  });
});

describe("ɵparseSlashQuery", () => {
  it("reads the first line after a leading slash", () => {
    expect(ɵparseSlashQuery("/sum\r\nsecond line", true)).toBe("sum");
    expect(ɵparseSlashQuery("/", true)).toBe("");
  });

  it("is null when the text does not start with a slash", () => {
    expect(ɵparseSlashQuery("hello /sum", true)).toBeNull();
  });

  it("is null when the menu has no commands", () => {
    expect(ɵparseSlashQuery("/sum", false)).toBeNull();
  });
});

describe("ɵnextSlashIndex", () => {
  it.each([
    { index: -1, direction: "down", expected: 0 },
    { index: 0, direction: "down", expected: 1 },
    { index: 2, direction: "down", expected: 0 },
    { index: -1, direction: "up", expected: 2 },
    { index: 0, direction: "up", expected: 2 },
    { index: 2, direction: "up", expected: 1 },
  ] as const)(
    "moves $direction from $index to $expected in 3 rows",
    ({ index, direction, expected }) => {
      expect(ɵnextSlashIndex(index, 3, direction)).toBe(expected);
    },
  );

  it("keeps the index when there are no rows", () => {
    expect(ɵnextSlashIndex(-1, 0, "down")).toBe(-1);
  });
});

describe("ɵclampSlashIndex", () => {
  it("is -1 without rows, the index when in range, else 0", () => {
    expect(ɵclampSlashIndex(3, 0)).toBe(-1);
    expect(ɵclampSlashIndex(1, 2)).toBe(1);
    expect(ɵclampSlashIndex(5, 2)).toBe(0);
    expect(ɵclampSlashIndex(-1, 2)).toBe(0);
  });
});

describe("ɵresolveSlashKey", () => {
  const commands = [command("Attach"), command("Summarize")];
  const open = { query: "", commands, highlightIndex: 0 };

  it("ignores every key while the menu is closed", () => {
    expect(
      ɵresolveSlashKey({ key: "Escape" }, { ...open, query: null }),
    ).toEqual({ type: "none" });
  });

  it("moves the highlight with the arrow keys and wraps", () => {
    expect(
      ɵresolveSlashKey({ key: "ArrowDown" }, { ...open, highlightIndex: 1 }),
    ).toEqual({
      type: "highlight",
      index: 0,
    });
    expect(ɵresolveSlashKey({ key: "ArrowUp" }, open)).toEqual({
      type: "highlight",
      index: 1,
    });
  });

  it("leaves the arrow keys alone when no command matches", () => {
    expect(
      ɵresolveSlashKey(
        { key: "ArrowDown" },
        { ...open, commands: [], highlightIndex: -1 },
      ),
    ).toEqual({ type: "none" });
  });

  it("runs the highlighted command on Enter", () => {
    expect(
      ɵresolveSlashKey({ key: "Enter" }, { ...open, highlightIndex: 1 }),
    ).toEqual({
      type: "run",
      command: commands[1],
    });
  });

  it("lets Enter send the text when no row is highlighted", () => {
    expect(
      ɵresolveSlashKey({ key: "Enter" }, { ...open, highlightIndex: -1 }),
    ).toEqual({ type: "none" });
  });

  it("closes the menu on Escape", () => {
    expect(ɵresolveSlashKey({ key: "Escape" }, open)).toEqual({
      type: "close",
    });
  });

  it("leaves other keys to the composer", () => {
    expect(ɵresolveSlashKey({ key: "a" }, open)).toEqual({ type: "none" });
  });
});
