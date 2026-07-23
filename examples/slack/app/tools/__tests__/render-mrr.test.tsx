/**
 * `render_mrr` posts arbitrary app JSX (`<MrrCard/>`, `<BarChart/>`) via
 * `thread.post`, which auto-routes it to the Takumi image path. We drive the
 * handler with a fake `thread` whose `post` records each call and assert it's
 * invoked with the expected image options.
 */
import { describe, it, expect, vi } from "vitest";
import { renderMrrTool } from "../render-mrr.js";

describe("render_mrr tool", () => {
  it("posts an image card via thread.post", async () => {
    const post = vi.fn(
      async (_ui: unknown, _opts?: { filename?: string; title?: string }) => ({
        id: "F1",
      }),
    );
    const res = await renderMrrTool.handler({ value: "$48,200", delta: 12 }, {
      thread: { post } as never,
      platform: "slack",
    } as never);
    expect(post).toHaveBeenCalledTimes(1);
    // first arg is arbitrary JSX (the MrrCard node), second is options with a filename
    expect(post.mock.calls[0]![1]).toMatchObject({ filename: "mrr.png" });
    expect(res).toMatch(/MRR card/);
  });

  it("also posts a chart when series is provided", async () => {
    const post = vi.fn(
      async (_ui: unknown, _opts?: { filename?: string; title?: string }) => ({
        id: "F1",
      }),
    );
    const res = await renderMrrTool.handler(
      { value: "$1", delta: 0, series: [{ label: "Mon", value: 1 }] },
      { thread: { post } as never, platform: "slack" } as never,
    );
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]![1]).toMatchObject({ filename: "signups.png" });
    expect(res).toMatch(/MRR card and signups chart/);
  });

  it("skips the chart when series is an empty array", async () => {
    const post = vi.fn(
      async (_ui: unknown, _opts?: { filename?: string; title?: string }) => ({
        id: "F1",
      }),
    );
    const res = await renderMrrTool.handler(
      { value: "$1", delta: 0, series: [] },
      { thread: { post } as never, platform: "slack" } as never,
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(res).not.toMatch(/chart/);
  });
});
