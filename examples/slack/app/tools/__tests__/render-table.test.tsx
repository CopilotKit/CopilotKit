/**
 * `render_table` posts a `<Table>` JSX component to the thread. We drive the
 * handler with a fake `thread` whose `post` records the posted Renderable (or
 * throws to exercise the monospace fallback), then assert the rendering through
 * `renderToIR` → `renderSlackMessage` yields the expected Block Kit shape.
 */
import { describe, it, expect } from "vitest";
import { renderToIR } from "@copilotkit/bot-ui";
import { renderSlackMessage } from "@copilotkit/bot-slack";
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

interface TableBlock {
  type: string;
  rows?: Array<Array<{ type: string; text: string }>>;
  column_settings?: Array<{ align?: string }>;
}

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
  it("posts a <Table> rendering to a header + native table block", async () => {
    const { posts, ctx } = fakeThread();
    const out = (await renderTableTool.handler(
      { title: "Open issues", columns: COLS, rows: ROWS },
      ctx,
    )) as string;
    expect(posts).toHaveLength(1);
    expect(out).toBe("Rendered the table for the user.");

    const { blocks } = renderSlackMessage(renderToIR(posts[0] as never));
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "Open issues" },
    });
    const table = blocks.find((b) => b.type === "table") as
      | TableBlock
      | undefined;
    expect(table).toBeDefined();
    // Header row from columns, then one row per data row.
    expect(table?.rows).toHaveLength(3);
    expect(table?.rows?.[0]).toEqual([
      { type: "raw_text", text: "Issue" },
      { type: "raw_text", text: "Priority" },
    ]);
    expect(table?.rows?.[1]).toEqual([
      { type: "raw_text", text: "CPK-1" },
      { type: "raw_text", text: "High" },
    ]);
    // Alignment carries through column_settings.
    expect(table?.column_settings).toEqual([
      { align: "left" },
      { align: "right" },
    ]);
  });

  it("falls back to a monospace table when the native post is rejected", async () => {
    const { posts, ctx } = fakeThread(1);
    const out = (await renderTableTool.handler(
      { title: "Open issues", columns: COLS, rows: ROWS },
      ctx,
    )) as string;
    // First post threw; second (fallback) recorded.
    expect(posts).toHaveLength(1);
    expect(out).toBe("Rendered the table (monospace fallback) for the user.");

    // Fallback is a platform-neutral <Message><Header>…</Header><Section>…</Section></Message>.
    const { blocks } = renderSlackMessage(renderToIR(posts[0] as never));
    // Title is in a plain-text header block.
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "Open issues" },
    });
    // Monospace table is in the section block.
    const text = JSON.stringify(blocks);
    expect(text).toContain("```");
    expect(text).toContain("CPK-1");
  });

  it("clamps to 99 data rows and reports the drop", async () => {
    const { posts, ctx } = fakeThread();
    const manyRows = Array.from({ length: 150 }, (_, i) => [`r${i}`, "x"]);
    const out = (await renderTableTool.handler(
      { columns: COLS, rows: manyRows },
      ctx,
    )) as string;
    expect(out).toBe("Rendered the table for the user.");
    const { blocks } = renderSlackMessage(renderToIR(posts[0] as never));
    const table = blocks.find((b) => b.type === "table") as
      | TableBlock
      | undefined;
    // 99 data rows + 1 header row.
    expect(table?.rows).toHaveLength(100);
  });

  it("clamps to 20 columns and reports the drop", async () => {
    const { posts, ctx } = fakeThread();
    const manyCols = Array.from({ length: 25 }, (_, i) => ({
      header: `c${i}`,
    }));
    const wideRow = manyCols.map((_, i) => `v${i}`);
    const out = (await renderTableTool.handler(
      { columns: manyCols, rows: [wideRow] },
      ctx,
    )) as string;
    expect(out).toBe("Rendered the table for the user.");
    const { blocks } = renderSlackMessage(renderToIR(posts[0] as never));
    const table = blocks.find((b) => b.type === "table") as
      | TableBlock
      | undefined;
    expect(table?.rows?.[0]).toHaveLength(20);
  });
});

describe("clamp", () => {
  it("returns no notes when within limits", () => {
    const { notes } = clamp(COLS, ROWS);
    expect(notes).toEqual([]);
  });
});
