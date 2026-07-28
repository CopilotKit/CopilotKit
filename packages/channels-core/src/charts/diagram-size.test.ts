import { describe, it, expect } from "vitest";
import { diagramCanvasSize } from "./diagram.js";

function chain(n: number) {
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    label: `Step ${i}`,
  }));
  const edges = Array.from({ length: Math.max(0, n - 1) }, (_, i) => ({
    from: `n${i}`,
    to: `n${i + 1}`,
  }));
  return { nodes, edges };
}

describe("diagramCanvasSize", () => {
  it("grows down-flow height with chain depth so a long flow does not clip", () => {
    const small = chain(3);
    const big = chain(21);
    const h3 = diagramCanvasSize(small.nodes, small.edges, "down").height;
    const h21 = diagramCanvasSize(big.nodes, big.edges, "down").height;
    expect(h21).toBeGreaterThan(h3);
    // 21 layers must produce a canvas well past a default ~480px image.
    expect(h21).toBeGreaterThan(1500);
  });

  it("grows right-flow width with chain depth", () => {
    const big = chain(21);
    const { width, height } = diagramCanvasSize(big.nodes, big.edges, "right");
    expect(width).toBeGreaterThan(1500);
    expect(height).toBeGreaterThanOrEqual(240);
  });

  it("keeps a single-node diagram at sensible minimums", () => {
    const { width, height } = diagramCanvasSize(
      [{ id: "a", label: "A" }],
      [],
      "down",
    );
    expect(width).toBeGreaterThanOrEqual(480);
    expect(height).toBeGreaterThanOrEqual(300);
  });
});
