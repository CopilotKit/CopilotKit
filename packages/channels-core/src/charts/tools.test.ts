import { describe, it, expect, vi } from "vitest";
import { chartTool, diagramTool } from "./tools.js";
import { FlowDiagram } from "./diagram.js";
import { renderJsxToPng } from "../render/takumi.js";

const cfg = { fonts: [], stylesheets: [], width: 400, height: 300 };

function fakeThread() {
  const post = vi.fn(async (_ui: unknown, _opts?: unknown) => ({ id: "F1" }));
  return { post, ctx: { thread: { post }, platform: "test" } as never };
}

describe("chartTool (render_chart)", () => {
  it("renders a bar chart from {label,value} data and posts an image", async () => {
    const { post, ctx } = fakeThread();
    const msg = await chartTool.handler(
      {
        kind: "bar",
        title: "Sales",
        data: [
          { label: "a", value: 1 },
          { label: "b", value: 2 },
        ],
      } as never,
      ctx,
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![1]).toMatchObject({
      filename: "chart.png",
      title: "Sales",
    });
    expect(msg).toMatch(/bar chart/);
  });

  it("renders scatter from points", async () => {
    const { post, ctx } = fakeThread();
    await chartTool.handler(
      {
        kind: "scatter",
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 1 },
        ],
      } as never,
      ctx,
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("returns a helpful error (no throw) when required data is missing", async () => {
    const { post, ctx } = fakeThread();
    const msg = await chartTool.handler({ kind: "pie" } as never, ctx);
    expect(post).not.toHaveBeenCalled();
    expect(msg).toMatch(/needs `data`/);
  });
});

describe("diagramTool (render_diagram) + FlowDiagram", () => {
  it("posts a diagram image and confirms", async () => {
    const { post, ctx } = fakeThread();
    const msg = await diagramTool.handler(
      {
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b" }],
      } as never,
      ctx,
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(msg).toMatch(/flow diagram/);
  });

  it("FlowDiagram rasterizes a layered graph to a PNG", async () => {
    const png = await renderJsxToPng(
      FlowDiagram({
        nodes: [
          { id: "a", label: "Start" },
          { id: "b", label: "Middle" },
          { id: "c", label: "End" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
        ],
      }),
      cfg,
    );
    expect([png[0], png[1], png[2], png[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
