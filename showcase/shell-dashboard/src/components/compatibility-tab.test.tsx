import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompatibilityTab } from "./compatibility-tab";

afterEach(cleanup);

describe("Compatibility tab", () => {
  it("keeps platforms across columns and labels the assessment snapshot", () => {
    render(<CompatibilityTab />);
    expect(
      screen.getByRole("heading", { name: "Compatibility" }),
    ).toBeInTheDocument();
    expect(screen.getByText("August 19, 2026 snapshot")).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader");
    expect(
      headers.findIndex((h) => h.textContent?.includes("LangGraph")),
    ).toBeLessThan(
      headers.findIndex((h) => h.textContent?.includes("AWS Strands")),
    );
    expect(
      screen.getByTestId("compatibility-summary-langgraph"),
    ).toHaveTextContent("Not assessed");
  });

  it("expands SDK packages sideways while retaining separate variant scores", () => {
    render(<CompatibilityTab />);
    const summary = screen.getByTestId("compatibility-summary-microsoft");
    expect(summary).toHaveTextContent("100");
    expect(summary).toHaveTextContent("60");
    const before = screen.getAllByRole("columnheader").length;
    fireEvent.click(
      screen.getByRole("button", { name: "Expand Microsoft SDKs" }),
    );
    expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(before);
    expect(
      screen.getByRole("columnheader", { name: /agent-framework-core/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /Microsoft.Agents.AI.OpenAI/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("compatibility-summary-microsoft"),
    ).toBeInTheDocument();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    const widths = rows.map((row) =>
      Array.from(row.children).reduce(
        (sum, cell) => sum + Number(cell.getAttribute("colspan") ?? 1),
        0,
      ),
    );
    expect(new Set(widths).size).toBe(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Microsoft SDKs" }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(before);
  });

  it("filters to upgrade opportunities without turning unknown variants into scores", () => {
    render(<CompatibilityTab />);
    fireEvent.click(screen.getByRole("button", { name: /Needs upgrade/ }));
    expect(
      screen.queryByRole("button", { name: "Expand LangGraph SDKs" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand AWS Strands SDKs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("compatibility-summary-microsoft"),
    ).toHaveTextContent("Not assessed");
    fireEvent.click(screen.getByRole("button", { name: /All platforms/ }));
    expect(
      screen.getByRole("button", { name: "Expand LangGraph SDKs" }),
    ).toBeInTheDocument();
  });

  it("finds a package inside a collapsed platform and offers a recoverable empty state", () => {
    render(<CompatibilityTab />);
    const search = screen.getByRole("searchbox", {
      name: "Find a platform or SDK",
    });
    fireEvent.change(search, { target: { value: "agent-framework-core" } });
    expect(
      screen.getByRole("button", { name: "Expand Microsoft SDKs" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand AWS Strands SDKs" }),
    ).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "no-such-platform" } });
    expect(screen.getByText("No matching platforms")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(
      screen.getByRole("button", { name: "Expand LangGraph SDKs" }),
    ).toBeInTheDocument();
  });
});
