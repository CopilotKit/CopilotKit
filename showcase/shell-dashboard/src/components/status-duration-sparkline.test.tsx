/**
 * Unit tests for StatusDurationSparkline — pure-SVG inline sparkline. We
 * verify N-1 line segments for N points, dash fallback for <2 points, and
 * width/height prop overrides.
 *
 * Convention: durations[] is oldest → newest, so the rightmost point is
 * the most recent run.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusDurationSparkline } from "./status-duration-sparkline";

describe("StatusDurationSparkline", () => {
  it("renders an SVG element at the default size", () => {
    const { getByTestId } = render(
      <StatusDurationSparkline durations={[100, 200, 150]} />,
    );
    const svg = getByTestId("status-sparkline");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("width")).toBe("120");
    expect(svg.getAttribute("height")).toBe("24");
  });

  it("respects width and height props", () => {
    const { getByTestId } = render(
      <StatusDurationSparkline
        durations={[100, 200, 150]}
        width={240}
        height={48}
      />,
    );
    const svg = getByTestId("status-sparkline");
    expect(svg.getAttribute("width")).toBe("240");
    expect(svg.getAttribute("height")).toBe("48");
  });

  it("renders a polyline whose points count equals durations.length", () => {
    const durations = [100, 200, 150, 300];
    const { getByTestId } = render(
      <StatusDurationSparkline durations={durations} />,
    );
    const polyline = getByTestId("status-sparkline-polyline");
    const points = polyline.getAttribute("points") ?? "";
    // N points == N "x,y" pairs separated by spaces
    const pairs = points.trim().split(/\s+/).filter(Boolean);
    expect(pairs.length).toBe(durations.length);
    // sanity-check: each pair is "x,y"
    for (const p of pairs) {
      expect(p).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
    }
  });

  it("renders dash placeholder when fewer than 2 points", () => {
    const { getByTestId, queryByTestId } = render(
      <StatusDurationSparkline durations={[100]} />,
    );
    expect(getByTestId("status-sparkline-dash")).toBeDefined();
    expect(queryByTestId("status-sparkline-polyline")).toBeNull();
  });

  it("renders dash placeholder when zero points", () => {
    const { getByTestId, queryByTestId } = render(
      <StatusDurationSparkline durations={[]} />,
    );
    expect(getByTestId("status-sparkline-dash")).toBeDefined();
    expect(queryByTestId("status-sparkline-polyline")).toBeNull();
  });

  it("normalizes flat-line input without producing NaN coords", () => {
    const { getByTestId } = render(
      <StatusDurationSparkline durations={[100, 100, 100, 100]} />,
    );
    const polyline = getByTestId("status-sparkline-polyline");
    const points = polyline.getAttribute("points") ?? "";
    expect(points).not.toContain("NaN");
  });

  it("renders dash placeholder when width is zero (CR-B2.5)", () => {
    // innerW would be -4, which previously produced negative x coords.
    // Guard renders the flat-dash sentinel instead.
    const { getByTestId, queryByTestId } = render(
      <StatusDurationSparkline
        durations={[100, 200, 150]}
        width={0}
        height={24}
      />,
    );
    expect(getByTestId("status-sparkline-dash")).toBeDefined();
    expect(queryByTestId("status-sparkline-polyline")).toBeNull();
  });

  it("renders dash placeholder when width is at the padding boundary (CR-B2.5)", () => {
    // PADDING * 2 === 4 → innerW === 0 → must fall back to dash so
    // we don't try to draw across a zero-width inner area.
    const { getByTestId, queryByTestId } = render(
      <StatusDurationSparkline
        durations={[100, 200, 150]}
        width={3}
        height={24}
      />,
    );
    expect(getByTestId("status-sparkline-dash")).toBeDefined();
    expect(queryByTestId("status-sparkline-polyline")).toBeNull();
  });
});
