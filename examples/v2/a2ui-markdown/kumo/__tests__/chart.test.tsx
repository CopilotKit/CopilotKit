import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ECharts cannot draw in jsdom, so Kumo's Chart is replaced by a probe
// that records the props it gets.
const seen = vi.hoisted(() => ({ behaviors: [] as unknown[] }));
vi.mock("@cloudflare/kumo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cloudflare/kumo")>();
  return {
    ...actual,
    Chart: (props: { optionUpdateBehavior?: unknown }) => {
      seen.behaviors.push(props.optionUpdateBehavior);
      return null;
    },
  };
});

const { Chart } = await import("../chart");

const data = [
  { month: "Jan", revenue: 10 },
  { month: "Feb", revenue: 20 },
];

describe("Chart", () => {
  test("gives Kumo the same update behavior on every render", () => {
    seen.behaviors.length = 0;
    const { rerender } = render(<Chart data={data} xKey="month" />);
    rerender(<Chart data={data} xKey="month" title="Revenue" />);
    expect(seen.behaviors.length).toBeGreaterThanOrEqual(2);
    expect(seen.behaviors[0]).toBe(seen.behaviors[seen.behaviors.length - 1]);
  });

  test("has a data table for screen readers", () => {
    render(<Chart data={data} xKey="month" title="Revenue" />);
    const table = screen.getByRole("table", { name: "Revenue" });
    expect(table).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "revenue" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "20" })).toBeTruthy();
  });
});
