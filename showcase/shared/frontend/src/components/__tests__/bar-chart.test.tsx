import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BarChart } from "../bar-chart";

// recharts uses ResizeObserver internally via ResponsiveContainer
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  MockResizeObserver as unknown as typeof ResizeObserver;

describe("BarChart", () => {
  const sampleData = [
    { label: "Jan", value: 100 },
    { label: "Feb", value: 200 },
    { label: "Mar", value: 150 },
  ];

  it("renders title and description", () => {
    render(
      <BarChart
        title="Monthly Revenue"
        description="Revenue by month"
        data={sampleData}
      />,
    );
    expect(screen.getByText("Monthly Revenue")).toBeTruthy();
    expect(screen.getByText("Revenue by month")).toBeTruthy();
  });

  it("renders with data without crashing", () => {
    const { container } = render(
      <BarChart title="Sales" description="test" data={sampleData} />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("shows empty state for no data", () => {
    render(<BarChart title="Empty" description="nothing here" data={[]} />);
    expect(screen.getByText("No data available")).toBeTruthy();
  });

  it("shows empty state for null data", () => {
    render(
      <BarChart
        title="Null"
        description="null data"
        data={null as unknown as { label: string; value: number }[]}
      />,
    );
    expect(screen.getByText("No data available")).toBeTruthy();
  });
});
