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
 */
function computeLayers(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
): DiagramNode[][] {
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
  return layers;
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
 * for `direction: "right"`) of boxes, with a connector arrow between layers. A
 * linear process renders as a clean arrow-connected chain. Boxes are HTML (text
 * renders), arrows are SVG shapes.
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
  const layers = computeLayers(nodes, edges);
  const isRight = direction === "right";

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

  // Interleave layers with connector arrows.
  const flowChildren: ReactElement[] = [];
  layers.forEach((layerNodes, i) => {
    flowChildren.push(layerGroup(layerNodes, i));
    if (i < layers.length - 1) {
      flowChildren.push(
        h(
          "div",
          {
            key: `arrow${i}`,
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            },
          },
          arrow(direction, accent),
        ),
      );
    }
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
  );
}
