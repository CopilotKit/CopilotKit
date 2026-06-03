import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FrontendToolContext } from "@copilotkit/slack";

// Mock the local renderers so no headless browser is launched.
const renderChart = vi.fn(async () => Buffer.from("CHARTPNG"));
const renderDiagram = vi.fn(async () => Buffer.from("DIAGRAMPNG"));
vi.mock("../../render/chart.js", () => ({ renderChart }));
vi.mock("../../render/diagram.js", () => ({ renderDiagram }));

const { renderChartTool } = await import("../render-chart.js");
const { renderDiagramTool } = await import("../render-diagram.js");

function makeCtx() {
  const postFile = vi.fn(async () => ({ ok: true, fileId: "F1" }));
  const ctx = {
    client: {} as never,
    channel: "C1",
    threadTs: "100.0",
    botUserId: "BOT",
    conversationKey: "C1::100.0",
    postFile,
  } as FrontendToolContext;
  return { ctx, postFile };
}

beforeEach(() => {
  renderChart.mockClear();
  renderDiagram.mockClear();
});

describe("render_chart tool", () => {
  it("renders a config object and posts the PNG", async () => {
    const { ctx, postFile } = makeCtx();
    const out = JSON.parse(
      (await renderChartTool.handler(
        {
          title: "Revenue Q2",
          chartSpec: {
            type: "bar",
            data: { labels: ["a"], datasets: [{ data: [1] }] },
          },
        },
        ctx,
      )) as string,
    );
    expect(renderChart).toHaveBeenCalledWith(
      expect.objectContaining({ type: "bar" }),
    );
    expect(postFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "revenue-q2.png",
        title: "Revenue Q2",
      }),
    );
    expect(out).toMatchObject({ ok: true, posted: true });
  });

  it("returns ok:false (not a throw) when rendering fails", async () => {
    const { ctx, postFile } = makeCtx();
    renderChart.mockRejectedValueOnce(
      new Error("Chart.js render failed: bad type"),
    );
    const out = JSON.parse(
      (await renderChartTool.handler(
        {
          chartSpec: {
            type: "nope",
            data: { labels: [], datasets: [{ data: [] }] },
          },
        },
        ctx,
      )) as string,
    );
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Chart.js render failed");
    expect(postFile).not.toHaveBeenCalled();
  });
});

describe("render_diagram tool", () => {
  it("renders Mermaid and posts the PNG", async () => {
    const { ctx, postFile } = makeCtx();
    const out = JSON.parse(
      (await renderDiagramTool.handler(
        { title: "Flow", mermaid: "flowchart TD\n A-->B" },
        ctx,
      )) as string,
    );
    expect(renderDiagram).toHaveBeenCalledWith("flowchart TD\n A-->B");
    expect(postFile).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "flow.png" }),
    );
    expect(out).toMatchObject({ ok: true, posted: true });
  });

  it("surfaces a render error for the agent to repair", async () => {
    const { ctx, postFile } = makeCtx();
    renderDiagram.mockRejectedValueOnce(new Error("Parse error on line 2"));
    const out = JSON.parse(
      (await renderDiagramTool.handler({ mermaid: "bogus" }, ctx)) as string,
    );
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Parse error");
    expect(postFile).not.toHaveBeenCalled();
  });
});
