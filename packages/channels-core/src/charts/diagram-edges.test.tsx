/**
 * FlowDiagram must render the edges it was given, not merely the layering they
 * imply: two graphs over the same nodes that differ only in their edges must
 * produce different output, and an edge label must survive into the picture.
 *
 * Asserted by walking the returned element tree for its text — no react-dom
 * (channels-core doesn't depend on it) and no PNG diffing needed.
 */
import { describe, it, expect } from "vitest";
import { isValidElement } from "react";
import type { ReactElement } from "react";
import { FlowDiagram } from "./diagram.js";
import type { DiagramEdge, DiagramNode } from "./diagram.js";

const nodes: DiagramNode[] = [
  { id: "a", label: "Ingest" },
  { id: "b", label: "Score" },
  { id: "c", label: "Notify" },
];

/** Every string/number rendered anywhere in the tree, in document order. */
function texts(node: unknown, out: string[] = []): string[] {
  if (node == null || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) texts(child, out);
    return out;
  }
  if (isValidElement(node)) {
    const { children } = (node as ReactElement<{ children?: unknown }>).props;
    return texts(children, out);
  }
  return out;
}

const textOf = (edges: DiagramEdge[]): string =>
  texts(FlowDiagram({ nodes, edges })).join("|");

/** Element shape (tags + text), ignoring style objects — enough to compare graphs. */
function shape(node: unknown): unknown {
  if (node == null || typeof node === "boolean") return null;
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(shape);
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: unknown }>;
    return {
      type: typeof el.type === "string" ? el.type : "component",
      children: shape(el.props.children),
    };
  }
  return null;
}

describe("FlowDiagram edges", () => {
  it("renders an edge's label", () => {
    expect(textOf([{ from: "a", to: "b", label: "on new issue" }])).toContain(
      "on new issue",
    );
  });

  it("distinguishes a fan-out from a chain over the same nodes", () => {
    const fanOut = shape(
      FlowDiagram({
        nodes,
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
        ],
      }),
    );
    const chain = shape(
      FlowDiagram({
        nodes,
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
        ],
      }),
    );
    expect(JSON.stringify(fanOut)).not.toBe(JSON.stringify(chain));
  });

  it("names both endpoints when one gap carries several edges", () => {
    // With two arrows in the same gap, position alone can't say which boxes
    // each joins, so each connector is captioned with its endpoints.
    const out = textOf([
      { from: "a", to: "b" },
      { from: "a", to: "c" },
    ]);
    expect(out).toContain("Ingest -> Score");
    expect(out).toContain("Ingest -> Notify");
  });

  it("lists an edge the layered layout cannot route instead of dropping it", () => {
    // a -> c skips a layer (a=0, b=1, c=2), so there is no adjacent gap to draw
    // it in; it must still appear, as text under the flow.
    const out = textOf([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "a", to: "c", label: "fast path" },
    ]);
    expect(out).toContain("Ingest -> Notify");
    expect(out).toContain("fast path");
  });

  it("renders every edge of a cyclic graph", () => {
    // Longest-path layering can't order a cycle meaningfully; whichever bucket
    // each edge lands in, none may vanish.
    const out = textOf([
      { from: "a", to: "b", label: "run" },
      { from: "b", to: "c", label: "post" },
      { from: "c", to: "a", label: "retry" },
    ]);
    for (const label of ["run", "post", "retry"]) expect(out).toContain(label);
  });

  it("renders a plain chain without endpoint captions (position is unambiguous)", () => {
    const out = textOf([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ]);
    expect(out).not.toContain("->");
  });

  it("ignores edges referencing unknown nodes", () => {
    expect(
      textOf([{ from: "a", to: "ghost", label: "nowhere" }]),
    ).not.toContain("nowhere");
  });
});
