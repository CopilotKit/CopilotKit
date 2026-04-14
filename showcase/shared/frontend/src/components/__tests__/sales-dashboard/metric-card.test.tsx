import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricCard } from "../../sales-dashboard/metric-card";

describe("MetricCard", () => {
  it("renders label", () => {
    render(<MetricCard label="Total Pipeline" value="$245,000" />);
    expect(screen.getByText("Total Pipeline")).toBeTruthy();
  });

  it("renders value", () => {
    render(<MetricCard label="Total Pipeline" value="$245,000" />);
    expect(screen.getByText("$245,000")).toBeTruthy();
  });

  it("renders without trend indicator by default", () => {
    render(<MetricCard label="Total Pipeline" value="$245,000" />);
    expect(screen.queryByTestId("trend-indicator")).toBeNull();
  });

  // --- All 3 trend variants ---

  it("shows upward trend indicator with green color", () => {
    render(
      <MetricCard
        label="Revenue"
        value="$100,000"
        trend={{ direction: "up", percentage: 12 }}
      />,
    );
    const trend = screen.getByTestId("trend-indicator");
    expect(trend).toBeTruthy();
    expect(trend.textContent).toContain("12%");
    expect(trend.textContent).toContain("\u2191");
    expect(trend.className).toContain("text-green-600");
  });

  it("shows downward trend indicator with red color", () => {
    render(
      <MetricCard
        label="Churn"
        value="5%"
        trend={{ direction: "down", percentage: 3 }}
      />,
    );
    const trend = screen.getByTestId("trend-indicator");
    expect(trend.textContent).toContain("3%");
    expect(trend.textContent).toContain("\u2193");
    expect(trend.className).toContain("text-red-600");
  });

  it("shows neutral trend indicator with muted color", () => {
    render(
      <MetricCard
        label="Deals"
        value="42"
        trend={{ direction: "neutral", percentage: 0 }}
      />,
    );
    const trend = screen.getByTestId("trend-indicator");
    expect(trend.textContent).toContain("0%");
    expect(trend.textContent).toContain("\u2192");
    expect(trend.className).toContain("text-[var(--muted-foreground)]");
  });

  // --- Large numbers ---

  it("renders large number values correctly", () => {
    render(<MetricCard label="Revenue" value="$1,250,000" />);
    expect(screen.getByText("$1,250,000")).toBeTruthy();
  });

  it("renders very large percentage in trend", () => {
    render(
      <MetricCard
        label="Growth"
        value="$500K"
        trend={{ direction: "up", percentage: 150 }}
      />,
    );
    const trend = screen.getByTestId("trend-indicator");
    expect(trend.textContent).toContain("150%");
  });

  it("renders decimal percentage in trend", () => {
    render(
      <MetricCard
        label="Conversion"
        value="3.5%"
        trend={{ direction: "up", percentage: 0.5 }}
      />,
    );
    const trend = screen.getByTestId("trend-indicator");
    expect(trend.textContent).toContain("0.5%");
  });

  // --- No trend default ---

  it("does not render trend element when trend is undefined", () => {
    const { container } = render(<MetricCard label="Simple" value="100" />);
    const trendEl = container.querySelector("[data-testid='trend-indicator']");
    expect(trendEl).toBeNull();
  });

  // --- Label styling ---

  it("label has uppercase tracking-wider styling", () => {
    render(<MetricCard label="Test Label" value="999" />);
    const label = screen.getByText("Test Label");
    expect(label.className).toContain("uppercase");
    expect(label.className).toContain("tracking-wider");
  });

  // --- Value styling ---

  it("value has bold text-2xl styling", () => {
    render(<MetricCard label="Test" value="$1M" />);
    const value = screen.getByText("$1M");
    expect(value.className).toContain("text-2xl");
    expect(value.className).toContain("font-bold");
  });

  it("has metric-card test id", () => {
    render(<MetricCard label="Test" value="123" />);
    expect(screen.getByTestId("metric-card")).toBeTruthy();
  });

  // --- Card container ---

  it("card has border and rounded styling", () => {
    render(<MetricCard label="Box" value="0" />);
    const card = screen.getByTestId("metric-card");
    expect(card.className).toContain("rounded-lg");
    expect(card.className).toContain("border");
  });
});
