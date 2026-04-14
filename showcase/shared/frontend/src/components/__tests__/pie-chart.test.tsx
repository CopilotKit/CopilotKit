import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PieChart } from "../pie-chart";

describe("PieChart", () => {
  const sampleData = [
    { label: "Engineering", value: 50 },
    { label: "Marketing", value: 30 },
    { label: "Sales", value: 20 },
  ];

  it("renders SVG with correct number of data segments", () => {
    const { container } = render(
      <PieChart
        title="Department Budget"
        description="Q1 allocation"
        data={sampleData}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    // 1 background circle + 3 data circles
    const circles = svg!.querySelectorAll("circle");
    expect(circles.length).toBe(1 + sampleData.length);
  });

  it("shows title and description", () => {
    render(
      <PieChart
        title="Department Budget"
        description="Q1 allocation"
        data={sampleData}
      />,
    );
    expect(screen.getByText("Department Budget")).toBeTruthy();
    expect(screen.getByText("Q1 allocation")).toBeTruthy();
  });

  it("shows legend with labels and percentages", () => {
    render(<PieChart title="Budget" description="test" data={sampleData} />);
    expect(screen.getByText("Engineering")).toBeTruthy();
    expect(screen.getByText("Marketing")).toBeTruthy();
    expect(screen.getByText("Sales")).toBeTruthy();
    // 50/100 = 50%, 30/100 = 30%, 20/100 = 20%
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("30%")).toBeTruthy();
    expect(screen.getByText("20%")).toBeTruthy();
  });

  it("shows legend values as formatted numbers", () => {
    const bigData = [{ label: "Revenue", value: 1500 }];
    render(<PieChart title="Revenue" description="desc" data={bigData} />);
    expect(screen.getByText("1,500")).toBeTruthy();
  });

  it("handles empty data gracefully", () => {
    render(<PieChart title="Empty Chart" description="no data" data={[]} />);
    expect(screen.getByText("Empty Chart")).toBeTruthy();
    expect(screen.getByText("No data available")).toBeTruthy();
  });

  it("handles null/undefined data gracefully", () => {
    render(
      <PieChart
        title="Null Chart"
        description="no data"
        data={null as unknown as { label: string; value: number }[]}
      />,
    );
    expect(screen.getByText("No data available")).toBeTruthy();
  });
});
