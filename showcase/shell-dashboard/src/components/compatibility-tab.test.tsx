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

function getMetricCell(metric: string, column: string) {
  const header = screen.getByRole<HTMLTableCellElement>("columnheader", {
    name: column,
  });
  const row = screen.getByRole("rowheader", { name: metric }).closest("tr")!;
  return row.cells[header.cellIndex];
}

describe("Compatibility tab", () => {
  it("keeps platforms across columns and labels the assessment snapshot", () => {
    const { container } = render(<CompatibilityTab />);
    expect(
      screen.getByRole("heading", { name: "Compatibility" }),
    ).toBeInTheDocument();
    expect(screen.getByText("September 17, 2026 snapshot")).toBeInTheDocument();
    expect(container).toHaveTextContent("17 / 21 variants scored");
    expect(container).toHaveTextContent("58 SDK package entries");
    expect(container).toHaveTextContent("3 not scored");
    expect(container).toHaveTextContent("1 not applicable");
    const headers = screen.getAllByRole("columnheader");
    expect(
      headers.findIndex((h) => h.textContent?.includes("LangGraph")),
    ).toBeLessThan(
      headers.findIndex((h) => h.textContent?.includes("AWS Strands")),
    );
    expect(
      screen.getByTestId("compatibility-summary-langgraph"),
    ).toHaveTextContent("70");
  });

  it("renders MAF and AWS variants as separate base columns with current-only scores", () => {
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
    ).toHaveTextContent("60");
    expect(
      screen.getByTestId("compatibility-summary-strands"),
    ).toHaveTextContent("100");
    expect(
      screen.getByTestId("compatibility-summary-strands-typescript"),
    ).toHaveTextContent("100");
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
    expect(screen.getAllByRole("columnheader")).toHaveLength(before + 8);
    expect(
      screen.getByRole("columnheader", { name: /Microsoft.Agents.AI.OpenAI/ }),
    ).toBeInTheDocument();
    expectAlignedRows();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse MAF Python SDKs" }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(before + 5);
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
    expect(screen.getAllByRole("columnheader")).toHaveLength(before + 3);
    expect(
      screen.getByRole("columnheader", { name: /^Python strands-agents$/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: /@strands-agents\/sdk/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand AWS Strands TypeScript SDKs",
      }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(before + 5);
    expect(
      screen.getByRole("columnheader", { name: /@strands-agents\/sdk/ }),
    ).toBeInTheDocument();
    expectAlignedRows();
  });

  it("filters to current numeric scores without turning unknown variants into scores", () => {
    render(<CompatibilityTab />);
    fireEvent.click(screen.getByRole("button", { name: /Current score/ }));
    expect(
      screen.getByRole("button", { name: "Expand LangGraph SDKs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand MAF Python SDKs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand .NET Harness SDKs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand AWS Strands Python SDKs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand CrewAI SDKs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Expand AWS Strands TypeScript SDKs",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("compatibility-summary-crewai"),
    ).toHaveTextContent("100");
    expect(
      screen.getByTestId("compatibility-summary-langgraph"),
    ).toHaveTextContent("70");
    expect(
      screen.getByTestId("compatibility-summary-ms-agent-python"),
    ).toHaveTextContent("100");
    expect(
      screen.getByTestId("compatibility-summary-strands"),
    ).toHaveTextContent("100");
    expect(
      screen.getByTestId("compatibility-summary-strands-typescript"),
    ).toHaveTextContent("100");
    expect(
      screen.getByTestId("compatibility-summary-ms-agent-harness-dotnet"),
    ).toHaveTextContent("60");
    expect(
      screen.queryByRole("button", { name: "Expand AG2 SDKs" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand Google ADK SDKs" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand Langroid SDKs" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /All platforms/ }));
    expect(
      screen.getByRole("button", { name: "Expand LangGraph SDKs" }),
    ).toBeInTheDocument();
  });

  it("keeps variant scores in overview columns when SDK packages are expanded", () => {
    render(<CompatibilityTab />);
    fireEvent.click(screen.getByRole("button", { name: "Expand CrewAI SDKs" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand AWS Strands TypeScript SDKs",
      }),
    );

    expect(
      screen.getByTestId("compatibility-summary-crewai"),
    ).toHaveTextContent("100");
    expect(
      screen.getByTestId("compatibility-summary-strands-typescript"),
    ).toHaveTextContent("100");
    for (const column of [
      "Conversational flows ag-ui-crewai",
      "Conversational flows crewai",
      "Conversational flows crewai-tools",
      "Flows ag-ui-crewai",
      "TypeScript @ag-ui/aws-strands",
      "TypeScript @strands-agents/sdk",
    ]) {
      expect(getMetricCell("Compatibility", column)).toHaveTextContent(/^—$/);
    }
  });

  it("keeps a single Running version field and distinguishes unavailable registry versions", () => {
    render(<CompatibilityTab />);
    expect(
      screen.getAllByRole("rowheader", { name: "Running version" }),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Expand Spring AI SDKs" }),
    );

    for (const column of [
      "Java com.ag-ui.community:java-server / com.ag-ui.community:spring",
      "Java com.ag-ui.community:spring-ai",
    ]) {
      expect(getMetricCell("Grace target", column)).toHaveTextContent(
        /^Not available$/,
      );
      expect(getMetricCell("Latest", column)).toHaveTextContent(
        /^Not available$/,
      );
      expect(getMetricCell("Registry", column)).toHaveTextContent(
        /^Not available$/,
      );
    }
    expect(
      getMetricCell(
        "Running version",
        "Java com.ag-ui.community:java-server / com.ag-ui.community:spring",
      ),
    ).toHaveTextContent(/^0\.0\.1$/);
    expect(
      getMetricCell("Running version", "Java com.ag-ui.community:spring-ai"),
    ).toHaveTextContent(/^1\.0\.1$/);
  });

  it("summarizes multiple registry sources until their SDK columns are expanded", () => {
    render(<CompatibilityTab />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Find a platform or SDK" }),
      { target: { value: "AWS Strands TypeScript" } },
    );

    expect(
      getMetricCell("Registry", "Overview 1 variant · individual scores"),
    ).toHaveTextContent(/^Expand SDKs$/);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand AWS Strands TypeScript SDKs",
      }),
    );

    for (const name of ["@ag-ui/aws-strands", "@strands-agents/sdk"]) {
      const cell = getMetricCell("Registry", `TypeScript ${name}`);
      expect(
        within(cell).getByRole("link", { name: "Registry" }),
      ).toHaveAttribute("href", `https://www.npmjs.com/package/${name}`);
      expect(cell).not.toHaveTextContent("Not available");
    }
  });

  it("scores Harness against its stable target while preserving the running preview version", () => {
    render(<CompatibilityTab />);
    fireEvent.click(
      screen.getByRole("button", { name: "Expand .NET Harness SDKs" }),
    );

    expect(
      screen.getByRole("columnheader", {
        name: /Microsoft.Agents.AI.Harness/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("compatibility-summary-ms-agent-harness-dotnet"),
    ).toHaveTextContent("60");
    const column = ".NET Harness Microsoft.Agents.AI.Harness";
    expect(getMetricCell("Running version", column)).toHaveTextContent(
      /^1\.6\.1-preview\.260514\.1$/,
    );
    expect(getMetricCell("Grace target", column)).toHaveTextContent(
      /^1\.18\.0$/,
    );
    expect(getMetricCell("Latest", column)).toHaveTextContent(/^1\.21\.0$/);
    expect(
      getMetricCell(
        "Running version",
        ".NET Harness Microsoft.Extensions.AI.OpenAI",
      ),
    ).toHaveTextContent(/^10\.5\.1$/);
    expect(
      getMetricCell("Running version", ".NET Harness OpenAI"),
    ).toHaveTextContent(/^2\.10\.0$/);
    expect(screen.queryByText(/\brepository\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\brepo\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/build verified/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/runtime observed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/origin\/main/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bdeployed\b/i)).not.toBeInTheDocument();
  });

  it("keeps range and unresolved declarations unscored", () => {
    render(<CompatibilityTab />);

    expect(screen.getByTestId("compatibility-summary-ag2")).toHaveTextContent(
      "Not verified",
    );
    expect(
      screen.getByTestId("compatibility-summary-google-adk"),
    ).toHaveTextContent("Not verified");
    expect(
      screen.getByTestId("compatibility-summary-langroid"),
    ).toHaveTextContent("Not verified");
    expect(
      screen.getByTestId("compatibility-summary-built-in-agent"),
    ).toHaveTextContent("Not applicable");

    for (const name of ["AG2", "Google ADK", "Langroid"]) {
      fireEvent.click(
        screen.getByRole("button", { name: `Expand ${name} SDKs` }),
      );
    }

    expect(
      screen.getByRole("columnheader", { name: /^Python ag2$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /^Python google-adk$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /^Python langroid$/ }),
    ).toBeInTheDocument();
    expect(getMetricCell("Running version", "Python ag2")).toHaveTextContent(
      /^Not verified$/,
    );
    expect(
      getMetricCell("Running version", "Python google-adk"),
    ).toHaveTextContent(/^Not verified$/);
    expect(
      getMetricCell("Running version", "Python ag-ui-adk"),
    ).toHaveTextContent(/^0\.7\.0$/);
    expect(
      getMetricCell("Running version", "Python langroid"),
    ).toHaveTextContent(/^Not verified$/);
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

  it("uses distinct expanded keys for standalone package inventory", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      render(<CompatibilityTab />);
      const before = screen.getAllByRole("columnheader").length;

      fireEvent.click(
        screen.getByRole("button", { name: "Expand .NET Harness SDKs" }),
      );
      expect(screen.getAllByRole("columnheader")).toHaveLength(before + 5);
      expect(
        screen.getByRole("columnheader", {
          name: /Microsoft.Agents.AI.Harness/,
        }),
      ).toBeInTheDocument();
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
