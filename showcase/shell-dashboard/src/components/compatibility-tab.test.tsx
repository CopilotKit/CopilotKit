import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompatibilityTab } from "./compatibility-tab";

afterEach(cleanup);

function expectAlignedRows() {
  const table = screen.getByRole("table");
  const rows = within(table).getAllByRole("row");
  const widths = rows.map((row) =>
    Array.from(row.children).reduce(
      (sum, cell) => sum + Number(cell.getAttribute("colspan") ?? 1),
      0,
    ),
  );
  expect(new Set(widths).size).toBe(1);
}

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

  it("renders MAF and AWS variants as separate base columns with independent scores", () => {
    render(<CompatibilityTab />);

    for (const name of [
      "MAF Python",
      "MAF .NET",
      ".NET Harness",
      "AWS Strands Python",
      "AWS Strands TypeScript",
    ]) {
      expect(
        screen.getByRole("button", { name: `Expand ${name} SDKs` }),
      ).toBeInTheDocument();
    }

    expect(
      screen.getByTestId("compatibility-summary-ms-agent-python"),
    ).toHaveTextContent("100");
    expect(
      screen.getByTestId("compatibility-summary-ms-agent-dotnet"),
    ).toHaveTextContent("60");
    expect(
      screen.getByTestId("compatibility-summary-ms-agent-harness-dotnet"),
    ).toHaveTextContent("Not assessed");
    expect(
      screen.getByTestId("compatibility-summary-strands"),
    ).toHaveTextContent("100");
    expect(
      screen.getByTestId("compatibility-summary-strands-typescript"),
    ).toHaveTextContent("60");
  });

  it("expands and collapses MAF SDK columns independently", () => {
    render(<CompatibilityTab />);
    const before = screen.getAllByRole("columnheader").length;
    fireEvent.click(
      screen.getByRole("button", { name: "Expand MAF Python SDKs" }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(before + 3);
    expect(
      screen.getByRole("columnheader", { name: /agent-framework-core/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", {
        name: /Microsoft.Agents.AI.OpenAI/,
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Expand MAF .NET SDKs" }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(before + 5);
    expect(
      screen.getByRole("columnheader", { name: /Microsoft.Agents.AI.OpenAI/ }),
    ).toBeInTheDocument();
    expectAlignedRows();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse MAF Python SDKs" }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(before + 2);
    expect(
      screen.getByRole("columnheader", { name: /Microsoft.Agents.AI.OpenAI/ }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse MAF .NET SDKs" }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(before);
  });

  it("expands AWS SDK columns independently", () => {
    render(<CompatibilityTab />);
    const before = screen.getAllByRole("columnheader").length;

    fireEvent.click(
      screen.getByRole("button", { name: "Expand AWS Strands Python SDKs" }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(before + 1);
    expect(
      screen.getByRole("columnheader", { name: /strands-agents/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: /@strands-agents\/sdk/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand AWS Strands TypeScript SDKs",
      }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(before + 2);
    expect(
      screen.getByRole("columnheader", { name: /@strands-agents\/sdk/ }),
    ).toBeInTheDocument();
    expectAlignedRows();
  });

  it("filters to upgrade opportunities without turning unknown variants into scores", () => {
    render(<CompatibilityTab />);
    fireEvent.click(screen.getByRole("button", { name: /Needs upgrade/ }));
    expect(
      screen.queryByRole("button", { name: "Expand LangGraph SDKs" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand MAF Python SDKs" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand .NET Harness SDKs" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand AWS Strands Python SDKs" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand MAF .NET SDKs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Expand AWS Strands TypeScript SDKs",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("compatibility-summary-ms-agent-dotnet"),
    ).toHaveTextContent("60");
    expect(
      screen.getByTestId("compatibility-summary-strands-typescript"),
    ).toHaveTextContent("60");
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
      screen.getByRole("button", { name: "Expand MAF Python SDKs" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand MAF .NET SDKs" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand AWS Strands Python SDKs" }),
    ).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "no-such-platform" } });
    expect(screen.getByText("No matching platforms")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(
      screen.getByRole("button", { name: "Expand LangGraph SDKs" }),
    ).toBeInTheDocument();
  });

  it("uses a distinct expanded placeholder key for an unassessed standalone integration", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      render(<CompatibilityTab />);
      const before = screen.getAllByRole("columnheader").length;

      fireEvent.click(
        screen.getByRole("button", { name: "Expand .NET Harness SDKs" }),
      );
      expect(screen.getAllByRole("columnheader")).toHaveLength(before + 1);
      expect(
        screen.getByRole("button", { name: "Expand AWS Strands Python SDKs" }),
      ).toBeInTheDocument();
      expectAlignedRows();

      fireEvent.click(
        screen.getByRole("button", { name: "Collapse .NET Harness SDKs" }),
      );
      expect(screen.getAllByRole("columnheader")).toHaveLength(before);
      expect(
        screen.getByRole("button", { name: "Expand AWS Strands Python SDKs" }),
      ).toBeInTheDocument();

      expect(
        consoleError.mock.calls.some((call) =>
          call.some((part) =>
            String(part).includes("Encountered two children with the same key"),
          ),
        ),
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});
