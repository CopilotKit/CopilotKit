/**
 * `render_table` posts a `<Table>` JSX component to the thread. We drive the
 * handler with a fake `thread` whose `post` records the posted Renderable (or
 * throws to exercise the monospace fallback), then assert the rendering through
 * `renderToIR` yields the expected IR shape.
 */
import { describe, it, expect } from "vitest";
import { renderToIR } from "@copilotkit/bot-ui";
import type { BotNode } from "@copilotkit/bot-ui";
import { renderTableTool, toMonospaceTable, clamp } from "../render-table.js";

type HandlerCtx = Parameters<typeof renderTableTool.handler>[1];

const COLS = [
  { header: "Issue" },
  { header: "Priority", align: "right" as const },
];
const ROWS = [
  ["CPK-1", "High"],
  ["CPK-2", "Low"],
];

/** A fake `thread` recording each posted Renderable; optionally throws on post N. */
function fakeThread(throwOnPost?: number) {
  const posts: unknown[] = [];
  let n = 0;
  const thread = {
    post: async (ui: unknown) => {
      n += 1;
      if (throwOnPost === n) throw new Error("invalid_blocks");
      posts.push(ui);
      return { id: `m${n}` };
    },
  };
  return { posts, ctx: { thread } as unknown as HandlerCtx };
}

/** Recursively find all IR nodes of a given type. */
function findAll(nodes: BotNode[], type: string): BotNode[] {
  const out: BotNode[] = [];
  for (const n of nodes) {
    if (n.type === type) out.push(n);
    const children = n.props?.children;
    const childArr = Array.isArray(children)
      ? (children as BotNode[])
      : children && typeof children === "object" && "type" in (children as object)
        ? [children as BotNode]
        : [];
    out.push(...findAll(childArr, type));
  }
  return out;
}

describe("toMonospaceTable", () => {
  it("renders a column-aligned, code-fenced table", () => {
    const out = toMonospaceTable(COLS, ROWS);
    expect(out.startsWith("```\n")).toBe(true);
    expect(out.endsWith("\n```")).toBe(true);
    // "Priority" (8) is the widest in column 2, so "High" is padded to width 8.
    expect(out).toContain("| CPK-1 | High     |");
    expect(out).toContain("| Issue | Priority |");
  });
});

describe("render_table tool", () => {
  it("posts a <Table> rendering with a header and table IR nodes", async () => {
    const { posts, ctx } = fakeThread();
    const out = (await renderTableTool.handler(
      { title: "Open issues", columns: COLS, rows: ROWS },
      ctx,
    )) as string;
    expect(posts).toHaveLength(1);
    expect(out).toBe("Rendered the table for the user.");

    const ir = renderToIR(posts[0] as never);
    const headers = findAll(ir, "header");
    expect(headers).toHaveLength(1);
    const tables = findAll(ir, "table");
    expect(tables).toHaveLength(1);
    // The table node has column props.
    expect(tables[0]?.props?.columns).toEqual(COLS);
    const rows = findAll(ir, "row");
    expect(rows).toHaveLength(2);
  });

  it("falls back to a monospace table when the post fails", async () => {
    const { posts, ctx } = fakeThread(1);
    const out = (await renderTableTool.handler(
      { title: "Open issues", columns: COLS, rows: ROWS },
      ctx,
    )) as string;
    // First post threw; second (fallback) recorded.
    expect(posts).toHaveLength(1);
    expect(out).toBe("Rendered the table (monospace fallback) for the user.");
    // The fallback is a plain markdown string containing the title and a
    // code-fenced table (not a raw-block object).
    expect(typeof posts[0]).toBe("string");
    const fallback = posts[0] as string;
    expect(fallback).toContain("**Open issues**");
    expect(fallback).toContain("```");
    expect(fallback).toContain("CPK-1");
  });

  it("clamps to 99 data rows", async () => {
    const { posts, ctx } = fakeThread();
    const manyRows = Array.from({ length: 150 }, (_, i) => [`r${i}`, "x"]);
    const out = (await renderTableTool.handler(
      { columns: COLS, rows: manyRows },
      ctx,
    )) as string;
    expect(out).toContain("Rendered the table for the user.");
    // Overflow note is appended to the success message.
    expect(out).toContain("first 99 of 150 rows");
    const ir = renderToIR(posts[0] as never);
    const rows = findAll(ir, "row");
    expect(rows).toHaveLength(99);
  });

  it("clamps to 20 columns", async () => {
    const { posts, ctx } = fakeThread();
    const manyCols = Array.from({ length: 25 }, (_, i) => ({
      header: `c${i}`,
    }));
    const wideRow = manyCols.map((_, i) => `v${i}`);
    const out = (await renderTableTool.handler(
      { columns: manyCols, rows: [wideRow] },
      ctx,
    )) as string;
    expect(out).toContain("Rendered the table for the user.");
    // Overflow note is appended to the success message.
    expect(out).toContain("first 20 of 25 columns");
    const ir = renderToIR(posts[0] as never);
    const cells = findAll(ir, "cell");
    expect(cells).toHaveLength(20);
  });
});

describe("clamp", () => {
  it("returns no notes when within limits", () => {
    const { notes } = clamp(COLS, ROWS);
    expect(notes).toEqual([]);
  });
});
