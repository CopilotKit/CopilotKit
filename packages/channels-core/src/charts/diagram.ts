import { createElement as h } from "react";
import type { ReactElement } from "react";
import { DEFAULT_CHART_COLORS } from "./types.js";
import type { ChartStyleProps } from "./types.js";

export interface DiagramNode {
  id: string;
  label: string;
}
export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}
export interface FlowDiagramProps extends ChartStyleProps {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** Flow direction: top-to-bottom ("down", default) or left-to-right ("right"). */
  direction?: "down" | "right";
}

/**
 * Assign each node a layer = its longest path from a root, so edges point from
 * lower to higher layers. Cycle-safe (capped iterations). Nodes unreachable
 * from any edge land in layer 0.
 *
 * Returns the per-layer node groups, each node's layer index, and the edges that
 * reference known nodes — the renderer needs all three to draw the edges
 * themselves rather than just the layering they imply.
 */
function layout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
): {
  layers: DiagramNode[][];
  layerOf: Map<string, number>;
  validEdges: DiagramEdge[];
} {
  const ids = new Set(nodes.map((n) => n.id));
  const valid = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  // Relax edges up to nodes.length times (longest-path; extra passes are no-ops
  // once stable, and the cap bounds any cycle).
  for (let i = 0; i < nodes.length; i++) {
    let changed = false;
    for (const e of valid) {
      const next = (layer.get(e.from) ?? 0) + 1;
      if (next > (layer.get(e.to) ?? 0)) {
        layer.set(e.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const maxLayer = Math.max(0, ...nodes.map((n) => layer.get(n.id) ?? 0));
  const layers: DiagramNode[][] = Array.from(
    { length: maxLayer + 1 },
    () => [],
  );
  for (const n of nodes) layers[layer.get(n.id) ?? 0]!.push(n);
  return { layers, layerOf: layer, validEdges: valid };
}

/**
 * Split edges into the ones drawable as a connector between adjacent layers and
 * the rest (skip-level, backward, and self edges — which a layered row/column
 * layout has nowhere to route). The remainder is listed as text under the flow
 * so a declared connection is never silently dropped from the picture.
 */
function partitionEdges(
  edges: DiagramEdge[],
  layerOf: Map<string, number>,
): { adjacent: Map<number, DiagramEdge[]>; extra: DiagramEdge[] } {
  const adjacent = new Map<number, DiagramEdge[]>();
  const extra: DiagramEdge[] = [];
  for (const e of edges) {
    const from = layerOf.get(e.from) ?? 0;
    const to = layerOf.get(e.to) ?? 0;
    if (to === from + 1) {
      const bucket = adjacent.get(from);
      if (bucket) bucket.push(e);
      else adjacent.set(from, [e]);
    } else {
      extra.push(e);
    }
  }
  return { adjacent, extra };
}

/**
 * Canvas size that fits a diagram's layout, so it never clips off the image.
 * Takumi renders at a fixed width×height and {@link FlowDiagram} fills it, so
 * the *caller* must pick a canvas big enough for the content. We grow it with
 * the flow's depth (number of layers, which determines the along-flow extent)
 * and breadth (widest layer), rather than a flat node count — a 20-step chain
 * needs a tall canvas even though each layer holds one box. Constants are
 * deliberately generous (extra space just centers as whitespace; too little
 * clips).
 */
export function diagramCanvasSize(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  direction: "down" | "right" = "down",
): { width: number; height: number } {
  const { layers, layerOf, validEdges } = layout(nodes, edges);
  const { adjacent, extra } = partitionEdges(validEdges, layerOf);
  const depth = Math.max(1, layers.length);
  const breadth = Math.max(1, ...layers.map((l) => l.length));
  // Widest connector bank: a gap crossed by N edges draws N labeled arrows.
  const fanout = Math.max(1, ...[...adjacent.values()].map((es) => es.length));
  const ALONG_BOX = 48; // box extent along the flow direction
  const ALONG_ARROW = 44; // labeled connector arrow + gaps along the flow
  const CHROME = 96; // outer padding + title + gaps
  const EXTRA_ROW = 20; // one line per edge listed under the flow
  const along = depth * ALONG_BOX + (depth - 1) * ALONG_ARROW + CHROME;
  const extraExtent = extra.length ? extra.length * EXTRA_ROW + 16 : 0;
  if (direction === "right") {
    return {
      width: Math.max(560, along),
      height: Math.max(
        240,
        Math.max(breadth, fanout) * 64 + CHROME + extraExtent,
      ),
    };
  }
  return {
    width: Math.max(480, Math.max(breadth, fanout) * 264 + CHROME),
    height: Math.max(300, along + extraExtent),
  };
}

function nodeBox(node: DiagramNode, color: string): ReactElement {
  return h(
    "div",
    {
      key: node.id,
      style: {
        display: "flex",
        padding: "10px 16px",
        borderRadius: 12,
        border: `1px solid ${color}`,
        backgroundColor: "#ffffff",
        color: "#010507",
        fontSize: 15,
        fontWeight: 600,
        maxWidth: 240,
        textAlign: "center",
      },
    },
    node.label,
  );
}

/** A short connector arrow (SVG line + triangle) pointing down or right. */
function arrow(direction: "down" | "right", color: string): ReactElement {
  if (direction === "right") {
    return h(
      "svg",
      { width: 26, height: 20, viewBox: "0 0 26 20" },
      h("line", {
        x1: 0,
        y1: 10,
        x2: 18,
        y2: 10,
        strokeWidth: 2,
        style: { stroke: color },
      }),
      h("path", { d: "M16,4 L24,10 L16,16 Z", style: { fill: color } }),
    );
  }
  return h(
    "svg",
    { width: 20, height: 24, viewBox: "0 0 20 24" },
    h("line", {
      x1: 10,
      y1: 0,
      x2: 10,
      y2: 16,
      strokeWidth: 2,
      style: { stroke: color },
    }),
    h("path", { d: "M4,14 L10,22 L16,14 Z", style: { fill: color } }),
  );
}

/**
 * A structured flow diagram (nodes + edges) rendered as layered boxes connected
 * by arrows. Layout is a simple longest-path layering — not arbitrary graph
 * auto-routing (Takumi has no JS layout engine): each layer is a row (or column
 * for `direction: "right"`) of boxes.
 *
 * Every declared edge is drawn, not just the layering it implies: a gap between
 * adjacent layers gets ONE arrow per edge crossing it, captioned with the edge's
 * `label` (and with `from -> to` when the gap carries more than one edge, since
 * position alone can't say which boxes an arrow joins). Edges a layered layout
 * cannot route — skip-level, backward, and self edges — are listed as
 * `from -> to` text beneath the flow rather than silently dropped. Boxes and
 * captions are HTML (text renders); arrows are SVG shapes.
 */
export function FlowDiagram(props: FlowDiagramProps): ReactElement {
  const {
    nodes,
    edges,
    direction = "down",
    colors = DEFAULT_CHART_COLORS,
    title,
    className,
    style,
    labelClassName,
  } = props;
  const palette = colors && colors.length > 0 ? colors : DEFAULT_CHART_COLORS;
  const accent = palette[0]!;
  const { layers, layerOf, validEdges } = layout(nodes, edges);
  const { adjacent, extra } = partitionEdges(validEdges, layerOf);
  const isRight = direction === "right";
  const labelOf = new Map(nodes.map((n) => [n.id, n.label]));
  // ASCII "->", not "→": Takumi's built-in font is Geist Latin, and a glyph it
  // lacks renders as tofu unless the app registers a font that has it.
  const edgeText = (e: DiagramEdge): string =>
    `${labelOf.get(e.from) ?? e.from} -> ${labelOf.get(e.to) ?? e.to}`;

  // A layer = a group of boxes laid perpendicular to the flow direction.
  const layerGroup = (layerNodes: DiagramNode[], i: number): ReactElement =>
    h(
      "div",
      {
        key: `layer${i}`,
        style: {
          display: "flex",
          flexDirection: isRight ? "column" : "row",
          gap: 14,
          alignItems: "center",
          justifyContent: "center",
        },
      },
      ...layerNodes.map((n) => nodeBox(n, accent)),
    );

  /** One arrow per edge crossing this gap, each captioned with what it carries. */
  const connectorBank = (gap: number): ReactElement => {
    const gapEdges = adjacent.get(gap) ?? [];
    const showEndpoints = gapEdges.length > 1;
    const connector = (e: DiagramEdge, j: number): ReactElement => {
      const caption = [e.label, showEndpoints ? edgeText(e) : undefined]
        .filter(Boolean)
        .join(": ");
      return h(
        "div",
        {
          key: `edge${gap}-${j}`,
          style: {
            display: "flex",
            // Caption reads alongside a left-to-right arrow, under a downward one.
            flexDirection: isRight ? "column" : "row",
            alignItems: "center",
            gap: 6,
          },
        },
        arrow(direction, accent),
        caption
          ? h(
              "div",
              {
                className: labelClassName,
                style: { fontSize: 12, color: "#5c6a71" },
              },
              caption,
            )
          : null,
      );
    };
    return h(
      "div",
      {
        key: `gap${gap}`,
        style: {
          display: "flex",
          // Arrows in one gap sit side by side across the flow, like the boxes.
          flexDirection: isRight ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        },
      },
      // A gap with no declared edge still needs the visual break between layers.
      ...(gapEdges.length
        ? gapEdges.map(connector)
        : [arrow(direction, accent)]),
    );
  };

  // Interleave layers with their connector banks.
  const flowChildren: ReactElement[] = [];
  layers.forEach((layerNodes, i) => {
    flowChildren.push(layerGroup(layerNodes, i));
    if (i < layers.length - 1) flowChildren.push(connectorBank(i));
  });

  return h(
    "div",
    {
      className,
      // Fill the whole post canvas so the background covers it and the flow
      // centers, instead of the diagram sizing to content in the top-left corner.
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 24,
        width: "100%",
        height: "100%",
        backgroundColor: "#ffffff",
        ...style,
      },
    },
    title
      ? h(
          "div",
          {
            className: labelClassName,
            style: { fontSize: 16, fontWeight: 700, color: "#010507" },
          },
          title,
        )
      : null,
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: isRight ? "row" : "column",
          gap: 6,
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
        },
      },
      ...flowChildren,
    ),
    // Edges the layered layout can't route (skip-level / backward / self):
    // listed rather than dropped, so the picture still accounts for every edge.
    extra.length
      ? h(
          "div",
          {
            className: labelClassName,
            style: {
              display: "flex",
              flexDirection: "column",
              gap: 2,
              fontSize: 12,
              color: "#5c6a71",
            },
          },
          ...extra.map((e, i) =>
            h(
              "div",
              { key: `extra${i}` },
              e.label ? `${edgeText(e)} (${e.label})` : edgeText(e),
            ),
          ),
        )
      : null,
  );
}
