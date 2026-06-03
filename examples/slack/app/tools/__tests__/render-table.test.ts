import { describe, it, expect, vi } from "vitest";
import type { FrontendToolContext } from "@copilotkit/slack";
import {
  renderTableTool,
  buildTableBlock,
  toMonospaceTable,
} from "../render-table.js";

const COLS = [
  { header: "Issue" },
  { header: "Priority", align: "right" as const },
];
const ROWS = [
  ["CPK-1", "High"],
  ["CPK-2", "Low"],
];

function makeCtx(postMessage: unknown): FrontendToolContext {
  return {
    client: { chat: { postMessage } },
    channel: "C1",
    threadTs: "100.0",
    botUserId: "BOT",
    conversationKey: "C1::100.0",
  } as unknown as FrontendToolContext;
}

describe("buildTableBlock", () => {
  it("puts the header row first, then data rows, as raw_text cells", () => {
    const block = buildTableBlock(COLS, ROWS);
    expect(block.type).toBe("table");
    expect(block.rows).toHaveLength(3);
    expect(block.rows[0]).toEqual([
      { type: "raw_text", text: "Issue" },
      { type: "raw_text", text: "Priority" },
    ]);
    expect(block.rows[1]).toEqual([
      { type: "raw_text", text: "CPK-1" },
      { type: "raw_text", text: "High" },
    ]);
  });

  it("emits sequential column_settings when any column is aligned", () => {
    const block = buildTableBlock(COLS, ROWS);
    expect(block.column_settings).toEqual([{}, { align: "right" }]);
  });

  it("omits column_settings entirely when no column is aligned", () => {
    const block = buildTableBlock([{ header: "A" }, { header: "B" }], ROWS);
    expect(block.column_settings).toBeUndefined();
  });

  it("pads short rows to the column count", () => {
    const block = buildTableBlock(COLS, [["only-one"]]);
    expect(block.rows[1]).toEqual([
      { type: "raw_text", text: "only-one" },
      { type: "raw_text", text: "" },
    ]);
  });
});

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

// Captures each postMessage payload so assertions can inspect blocks/text
// without indexing into the mock's tuple-typed `calls` (strict mode-friendly).
type PostArgs = {
  blocks?: Array<{ type: string; rows?: unknown[] }>;
  text?: string;
};

describe("render_table tool", () => {
  it("posts the native Table block and acks with the message ts", async () => {
    const calls: PostArgs[] = [];
    const postMessage = vi.fn(async (a: PostArgs) => {
      calls.push(a);
      return { ok: true, ts: "200.0" };
    });
    const out = JSON.parse(
      (await renderTableTool.handler(
        { title: "Open issues", columns: COLS, rows: ROWS },
        makeCtx(postMessage),
      )) as string,
    );
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(calls[0]?.blocks?.map((b) => b.type)).toEqual(["header", "table"]);
    expect(out).toMatchObject({ ok: true, posted: true, messageTs: "200.0" });
    expect(out.fellBackToMonospace).toBeUndefined();
  });

  it("falls back to a monospace table when the native block is rejected", async () => {
    const calls: PostArgs[] = [];
    const postMessage = vi.fn(async (a: PostArgs) => {
      calls.push(a);
      if (calls.length === 1) throw new Error("invalid_blocks");
      return { ok: true, ts: "201.0" };
    });
    const out = JSON.parse(
      (await renderTableTool.handler(
        { columns: COLS, rows: ROWS },
        makeCtx(postMessage),
      )) as string,
    );
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(calls[1]?.text).toContain("```");
    expect(calls[1]?.text).toContain("CPK-1");
    expect(out).toMatchObject({
      ok: true,
      posted: true,
      fellBackToMonospace: true,
      messageTs: "201.0",
    });
    expect(out.reason).toContain("invalid_blocks");
  });

  it("clamps to Slack's limits and reports what was dropped", async () => {
    const calls: PostArgs[] = [];
    const postMessage = vi.fn(async (a: PostArgs) => {
      calls.push(a);
      return { ok: true, ts: "202.0" };
    });
    const manyRows = Array.from({ length: 150 }, (_, i) => [`r${i}`, "x"]);
    const out = JSON.parse(
      (await renderTableTool.handler(
        { columns: COLS, rows: manyRows },
        makeCtx(postMessage),
      )) as string,
    );
    const table = calls[0]?.blocks?.find((b) => b.type === "table");
    // 99 data rows + 1 header row.
    expect(table?.rows).toHaveLength(100);
    expect(out.notes).toEqual(["only the first 99 of 150 rows shown"]);
  });

  it("clamps to 20 columns and reports the drop", async () => {
    const calls: PostArgs[] = [];
    const postMessage = vi.fn(async (a: PostArgs) => {
      calls.push(a);
      return { ok: true, ts: "203.0" };
    });
    const manyCols = Array.from({ length: 25 }, (_, i) => ({
      header: `c${i}`,
    }));
    const wideRow = manyCols.map((_, i) => `v${i}`);
    const out = JSON.parse(
      (await renderTableTool.handler(
        { columns: manyCols, rows: [wideRow] },
        makeCtx(postMessage),
      )) as string,
    );
    const table = calls[0]?.blocks?.find((b) => b.type === "table") as
      | { rows: Array<unknown[]> }
      | undefined;
    expect(table?.rows[0]).toHaveLength(20);
    expect(out.notes).toEqual(["only the first 20 of 25 columns shown"]);
  });

  it("returns ok:false (not a throw) when both posts fail", async () => {
    const postMessage = vi.fn(async (_a: PostArgs) => {
      throw new Error(
        postMessage.mock.calls.length === 1
          ? "invalid_blocks"
          : "channel_not_found",
      );
    });
    const out = JSON.parse(
      (await renderTableTool.handler(
        { columns: COLS, rows: ROWS },
        makeCtx(postMessage),
      )) as string,
    );
    expect(out.ok).toBe(false);
    expect(out.error).toContain("channel_not_found");
  });
});
