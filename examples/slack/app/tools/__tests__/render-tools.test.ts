import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToIR } from "@copilotkit/bot-ui";
import { renderSlackMessage } from "@copilotkit/bot-slack";

// Mock the local renderers so no headless browser is launched.
const renderChart = vi.fn(async () => Buffer.from("CHARTPNG"));
const renderDiagram = vi.fn(async () => Buffer.from("DIAGRAMPNG"));
vi.mock("../../render/chart.js", () => ({ renderChart }));
vi.mock("../../render/diagram.js", () => ({ renderDiagram }));

const { renderChartTool } = await import("../render-chart.js");
const { renderDiagramTool } = await import("../render-diagram.js");

/** The ctx a BotTool handler receives. */
type HandlerCtx = Parameters<typeof renderChartTool.handler>[1];

function makeCtx() {
  const postFile = vi.fn(async () => ({ ok: true, fileId: "F1" }));
  const posts: unknown[] = [];
  const thread = {
    post: vi.fn(async (ui: unknown) => {
      posts.push(ui);
      return { id: "m1" };
    }),
    postFile,
  };
  const ctx = { thread } as unknown as HandlerCtx;
  return { ctx, postFile, thread, posts };
}

beforeEach(() => {
  renderChart.mockClear();
  renderDiagram.mockClear();
});

describe("render_chart tool", () => {
  it("renders a config object and posts the PNG", async () => {
    const { ctx, postFile, posts } = makeCtx();
    const out = (await renderChartTool.handler(
      {
        title: "Revenue Q2",
        chartSpec: {
          type: "bar",
          data: { labels: ["a"], datasets: [{ data: [1] }] },
        },
      },
      ctx,
    )) as string;
    expect(renderChart).toHaveBeenCalledWith(
      expect.objectContaining({ type: "bar" }),
    );
    expect(postFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "revenue-q2.png",
        title: "Revenue Q2",
      }),
    );
    expect(out).toBe("Rendered and posted the chart image to the thread.");
    // The caption card was posted after the upload.
    expect(posts).toHaveLength(1);
    const { blocks } = renderSlackMessage(renderToIR(posts[0] as never));
    expect(JSON.stringify(blocks)).toContain(":bar_chart:");
    expect(JSON.stringify(blocks)).toContain("Revenue Q2");
  });

  it("returns ok:false (not a throw) when rendering fails", async () => {
    const { ctx, postFile } = makeCtx();
    renderChart.mockRejectedValueOnce(
      new Error("Chart.js render failed: bad type"),
    );
    const out = (await renderChartTool.handler(
      {
        chartSpec: {
          type: "nope",
          data: { labels: [], datasets: [{ data: [] }] },
        },
      },
      ctx,
    )) as string;
    expect(out).toContain("Chart render failed");
    expect(out).toContain("Chart.js render failed");
    expect(postFile).not.toHaveBeenCalled();
  });
});

describe("render_diagram tool", () => {
  it("renders Mermaid and posts the PNG", async () => {
    const { ctx, postFile, posts } = makeCtx();
    const out = (await renderDiagramTool.handler(
      { title: "Flow", mermaid: "flowchart TD\n A-->B" },
      ctx,
    )) as string;
    expect(renderDiagram).toHaveBeenCalledWith("flowchart TD\n A-->B");
    expect(postFile).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "flow.png" }),
    );
    expect(out).toBe("Rendered and posted the diagram image to the thread.");
    expect(posts).toHaveLength(1);
    const { blocks } = renderSlackMessage(renderToIR(posts[0] as never));
    expect(JSON.stringify(blocks)).toContain(":triangular_ruler:");
    expect(JSON.stringify(blocks)).toContain("Flow");
  });

  it("surfaces a render error for the agent to repair", async () => {
    const { ctx, postFile } = makeCtx();
    renderDiagram.mockRejectedValueOnce(new Error("Parse error on line 2"));
    const out = (await renderDiagramTool.handler(
      { mermaid: "bogus" },
      ctx,
    )) as string;
    expect(out).toContain("Diagram render failed");
    expect(out).toContain("Parse error");
    expect(postFile).not.toHaveBeenCalled();
  });
});
