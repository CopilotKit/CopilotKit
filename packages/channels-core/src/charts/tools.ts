import { z } from "zod";
import type { ReactElementLike } from "@copilotkit/channels-ui";
import { defineChannelTool } from "../tools.js";
import { BarChart } from "./bar-chart.js";
import { LineChart } from "./line-chart.js";
import { PieChart } from "./pie-chart.js";
import { StackedBar } from "./stacked-bar.js";
import { Scatter } from "./scatter.js";
import { FlowDiagram } from "./diagram.js";

const datum = z.object({ label: z.string(), value: z.number() });

const chartParams = z.object({
  kind: z
    .enum(["bar", "line", "pie", "stacked", "scatter"])
    .describe("Chart type to render."),
  title: z.string().optional().describe("Title shown above the chart."),
  data: z
    .array(datum)
    .optional()
    .describe(
      "For kind bar/line/pie: one {label, value} per category (e.g. a CSV column of categories and a numeric column).",
    ),
  stacks: z
    .array(z.object({ label: z.string(), values: z.array(z.number()) }))
    .optional()
    .describe(
      "For kind stacked: per category a {label, values}; each entry in `values` is a stacked segment (drawn in a distinct palette colour).",
    ),
  points: z
    .array(z.object({ x: z.number(), y: z.number() }))
    .optional()
    .describe("For kind scatter: the XY points."),
  filename: z.string().optional().describe("Uploaded image filename."),
});

/**
 * `render_chart` — turn structured data (e.g. a parsed CSV) into a bar, line,
 * pie, stacked-bar, or scatter chart and post it to the thread as an image.
 * A ready-made {@link import("../tools.js").ChannelTool} any bot can register:
 * `createChannel({ tools: [chartTool, ...] })`.
 */
export const chartTool = defineChannelTool({
  name: "render_chart",
  description:
    "Render a chart from structured data and post it to the thread as an image. " +
    "Use this to visualize tabular/CSV-like data as a bar, line, pie, stacked bar, or scatter chart. " +
    "Provide `data` ({label,value}[]) for bar/line/pie, `stacks`+`series` for stacked, or `points` for scatter.",
  parameters: chartParams,
  async handler(a, { thread }) {
    const { kind, title } = a;
    const file = a.filename ?? "chart.png";
    // Chart components return real React elements; cast to the post signature's
    // structural `ReactElementLike` (detect classifies by the runtime value).
    const post = (el: unknown, width: number, height: number) =>
      thread.post(el as ReactElementLike, {
        filename: file,
        title,
        width,
        height,
      });
    switch (kind) {
      case "bar":
        if (!a.data?.length)
          return "render_chart(bar) needs `data` as [{label, value}, …].";
        await post(BarChart({ data: a.data, title }), 760, 440);
        break;
      case "line":
        if (!a.data?.length)
          return "render_chart(line) needs `data` as [{label, value}, …].";
        await post(
          LineChart({ data: a.data, title, width: 760, height: 440 }),
          760,
          440,
        );
        break;
      case "pie":
        if (!a.data?.length)
          return "render_chart(pie) needs `data` as [{label, value}, …].";
        await post(
          PieChart({ data: a.data, title, width: 460, height: 460 }),
          460,
          460,
        );
        break;
      case "stacked":
        if (!a.stacks?.length)
          return "render_chart(stacked) needs `stacks` as [{label, values:number[]}, …].";
        await post(StackedBar({ data: a.stacks, title }), 760, 440);
        break;
      case "scatter":
        if (!a.points?.length)
          return "render_chart(scatter) needs `points` as [{x, y}, …].";
        await post(
          Scatter({ points: a.points, title, width: 760, height: 440 }),
          760,
          440,
        );
        break;
    }
    return `Rendered a ${kind} chart${title ? ` ("${title}")` : ""} to the thread as an image.`;
  },
});

/**
 * `render_diagram` — turn a set of nodes and directed edges into a flow diagram
 * (layered boxes + arrows) and post it as an image. Good for processes,
 * pipelines, architectures, and decision flows. Not arbitrary graph
 * auto-layout — see {@link FlowDiagram}.
 */
export const diagramTool = defineChannelTool({
  name: "render_diagram",
  description:
    "Render a flow diagram (nodes connected by directed edges) and post it to the thread as an image. " +
    "Use for a process, pipeline, architecture, or decision flow. Give each node a unique `id` and a `label`, " +
    "and connect them with `edges` ({from, to} by id).",
  parameters: z.object({
    title: z.string().optional().describe("Title shown above the diagram."),
    direction: z
      .enum(["down", "right"])
      .optional()
      .describe(
        "Flow direction: top-to-bottom (down, default) or left-to-right (right).",
      ),
    nodes: z
      .array(z.object({ id: z.string(), label: z.string() }))
      .describe("The boxes; each needs a unique `id` and a display `label`."),
    edges: z
      .array(
        z.object({
          from: z.string(),
          to: z.string(),
          label: z.string().optional(),
        }),
      )
      .describe("Directed edges between nodes, by `id`."),
    filename: z.string().optional().describe("Uploaded image filename."),
  }),
  async handler(a, { thread }) {
    if (!a.nodes?.length)
      return "render_diagram needs at least one node in `nodes`.";
    // Size the canvas to the flow so it fills the image rather than floating in a
    // wide frame: a top-to-bottom flow gets a portrait canvas, left-to-right a
    // landscape one. Height grows with the number of layers (roughly the chain).
    const right = a.direction === "right";
    const span = 120 + Math.min(a.nodes.length, 8) * (right ? 150 : 96);
    const width = right ? Math.max(760, span) : 620;
    const height = right ? 420 : Math.max(360, span);
    await thread.post(
      FlowDiagram({
        nodes: a.nodes,
        edges: a.edges ?? [],
        direction: a.direction,
        title: a.title,
      }) as ReactElementLike,
      { filename: a.filename ?? "diagram.png", title: a.title, width, height },
    );
    return `Rendered a flow diagram with ${a.nodes.length} node(s) to the thread as an image.`;
  },
});
