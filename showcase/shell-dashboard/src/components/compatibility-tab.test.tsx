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
    expect(container).toHaveTextContent("33 library entries");
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
    expect(
      screen.getByRole("columnheader", { name: "Libraries" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("rowheader", { name: "Library" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand Claude Agent SDK libraries" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("compatibility-summary-langgraph")).getByRole(
        "img",
        { name: "70 out of 100" },
      ),
    ).toBeInTheDocument();
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
        screen.getByRole("button", { name: `Expand ${name} libraries` }),
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

  it("expands and collapses MAF library columns independently", () => {
    render(<CompatibilityTab />);
    const before = screen.getAllByRole("columnheader").length;
    fireEvent.click(
      screen.getByRole("button", { name: "Expand MAF Python libraries" }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(before + 3);
    expect(
      screen.getByRole("columnheader", { name: /agent-framework-core/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", {
        name: /^\.NET Microsoft\.Agents\.AI\.Hosting\.AGUI\.AspNetCore$/,
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Expand MAF .NET libraries" }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(before + 4);
    expect(
      screen.getByRole("columnheader", {
        name: /^\.NET Microsoft\.Agents\.AI\.Hosting\.AGUI\.AspNetCore$/,
      }),
    ).toBeInTheDocument();
    expectAlignedRows();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse MAF Python libraries" }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(before + 1);
    expect(
      screen.getByRole("columnheader", {
        name: /^\.NET Microsoft\.Agents\.AI\.Hosting\.AGUI\.AspNetCore$/,
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse MAF .NET libraries" }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(before);
  });

  it("expands AWS library columns independently", () => {
    render(<CompatibilityTab />);
    const before = screen.getAllByRole("columnheader").length;

    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand AWS Strands Python libraries",
      }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(before + 1);
    expect(
      screen.getByRole("columnheader", { name: /^Python strands-agents$/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: /@strands-agents\/sdk/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand AWS Strands TypeScript libraries",
      }),
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(before + 2);
    expect(
      screen.getByRole("columnheader", { name: /@strands-agents\/sdk/ }),
    ).toBeInTheDocument();
    expectAlignedRows();
  });

  it("filters to current numeric scores without turning unknown variants into scores", () => {
    render(<CompatibilityTab />);
    fireEvent.click(screen.getByRole("button", { name: /Current score/ }));
    expect(
      screen.getByRole("button", { name: "Expand LangGraph libraries" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand MAF Python libraries" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand .NET Harness libraries" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Expand AWS Strands Python libraries",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand CrewAI libraries" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Expand AWS Strands TypeScript libraries",
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
      screen.queryByRole("button", { name: "Expand AG2 libraries" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand Google ADK libraries" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand Langroid libraries" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /All platforms/ }));
    expect(
      screen.getByRole("button", { name: "Expand LangGraph libraries" }),
    ).toBeInTheDocument();
  });

  it("shows library score contributions when packages are expanded", () => {
    render(<CompatibilityTab />);
    fireEvent.click(
      screen.getByRole("button", { name: "Expand CrewAI libraries" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand AWS Strands TypeScript libraries",
      }),
    );

    expect(
      screen.getByTestId("compatibility-summary-crewai"),
    ).toHaveTextContent("100");
    expect(
      screen.getByTestId("compatibility-summary-strands-typescript"),
    ).toHaveTextContent("100");
    for (const column of [
      "Conversational flows crewai",
      "Conversational flows crewai-tools",
      "Flows crewai",
      "Flows crewai-tools",
      "TypeScript @strands-agents/sdk",
    ]) {
      const cell = getMetricCell("Compatibility", column);
      expect(
        within(cell).getByRole("img", { name: "100 out of 100" }),
      ).toBeInTheDocument();
      expect(cell).toHaveTextContent(/100\s*Sets score/);
    }
  });

  it("marks only the minimum LangGraph TypeScript packages as setting the score", () => {
    render(<CompatibilityTab />);
    fireEvent.click(
      screen.getByRole("button", { name: "Expand LangGraph libraries" }),
    );

    const primaryPackage = getMetricCell(
      "Compatibility",
      "TypeScript @langchain/langgraph",
    );
    expect(primaryPackage).toHaveTextContent(/^90$/);
    expect(
      within(primaryPackage).getByRole("img", { name: "90 out of 100" }),
    ).toBeInTheDocument();
    expect(primaryPackage).not.toHaveTextContent(/Sets score/);
    for (const column of [
      "TypeScript @langchain/langgraph-api",
      "TypeScript @langchain/langgraph-sdk",
    ]) {
      const cell = getMetricCell("Compatibility", column);
      expect(
        within(cell).getByRole("img", { name: "70 out of 100" }),
      ).toBeInTheDocument();
      expect(cell).toHaveTextContent(/70\s*Sets score/);
    }
  });

  it("keeps a single Running version field and the contributing Spring libraries", () => {
    render(<CompatibilityTab />);
    expect(
      screen.getAllByRole("rowheader", { name: "Running version" }),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Expand Spring AI libraries" }),
    );

    for (const name of ["spring-ai-bom", "spring-ai-starter-model-openai"]) {
      const column = `Java org.springframework.ai:${name}`;
      expect(getMetricCell("Running version", column)).toHaveTextContent(
        /^1\.0\.1$/,
      );
      expect(getMetricCell("Grace target", column)).toHaveTextContent(
        /^2\.0\.0$/,
      );
      expect(getMetricCell("Latest", column)).toHaveTextContent(/^2\.0\.1$/);
      expect(
        within(getMetricCell("Compatibility", column)).getByRole("img", {
          name: "20 out of 100",
        }),
      ).toBeInTheDocument();
      expect(
        within(getMetricCell("Registry", column)).getByRole("link", {
          name: "Registry",
        }),
      ).toHaveAttribute(
        "href",
        `https://central.sonatype.com/artifact/org.springframework.ai/${name}`,
      );
    }
  });

  it("summarizes multiple registry sources until their library columns are expanded", () => {
    render(<CompatibilityTab />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Find a platform or library" }),
      { target: { value: "MAF Python" } },
    );

    expect(
      getMetricCell("Registry", "Overview 1 variant · individual scores"),
    ).toHaveTextContent(/^Expand libraries$/);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand MAF Python libraries",
      }),
    );

    for (const name of [
      "agent-framework-ag-ui",
      "agent-framework-core",
      "agent-framework-openai",
    ]) {
      const cell = getMetricCell("Registry", `Python ${name}`);
      expect(
        within(cell).getByRole("link", { name: "Registry" }),
      ).toHaveAttribute("href", `https://pypi.org/project/${name}/`);
      expect(cell).not.toHaveTextContent("Not available");
    }
  });

  it("shows a single contributing library's versions and registry while collapsed", () => {
    render(<CompatibilityTab />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Find a platform or library" }),
      { target: { value: "AWS Strands TypeScript" } },
    );

    const overview = "Overview 1 variant · individual scores";
    expect(getMetricCell("Running version", overview)).toHaveTextContent(
      /^1\.16\.0$/,
    );
    expect(getMetricCell("Grace target", overview)).toHaveTextContent(
      /^1\.13\.0$/,
    );
    expect(getMetricCell("Latest", overview)).toHaveTextContent(/^1\.18\.0$/);
    expect(
      within(getMetricCell("Registry", overview)).getByRole("link", {
        name: "Registry",
      }),
    ).toHaveAttribute(
      "href",
      "https://www.npmjs.com/package/@strands-agents/sdk",
    );
  });

  it("scores Harness against its stable target while preserving the running preview version", () => {
    render(<CompatibilityTab />);
    fireEvent.click(
      screen.getByRole("button", { name: "Expand .NET Harness libraries" }),
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
    const hostingColumn =
      ".NET Harness Microsoft.Agents.AI.Hosting.AGUI.AspNetCore";
    expect(getMetricCell("Running version", hostingColumn)).toHaveTextContent(
      /^1\.6\.1-preview\.260514\.1$/,
    );
    expect(getMetricCell("Grace target", hostingColumn)).toHaveTextContent(
      /^1\.18\.0-preview\.260818\.1$/,
    );
    expect(getMetricCell("Latest", hostingColumn)).toHaveTextContent(
      /^1\.21\.0-preview\.260911\.1$/,
    );
    expect(
      within(getMetricCell("Compatibility", column)).getByRole("img", {
        name: "60 out of 100",
      }),
    ).toBeInTheDocument();
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
        screen.getByRole("button", { name: `Expand ${name} libraries` }),
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
      getMetricCell("Compatibility", "Python google-adk"),
    ).toHaveTextContent(/^Not verified$/);
    expect(
      getMetricCell("Running version", "Python langroid"),
    ).toHaveTextContent(/^Not verified$/);
    for (const column of [
      "Python ag2",
      "Python google-adk",
      "Python langroid",
    ]) {
      const cell = getMetricCell("Compatibility", column);
      expect(cell).toHaveTextContent(/^Not verified$/);
      expect(within(cell).queryByRole("img")).not.toBeInTheDocument();
    }
  });

  it("finds a package inside a collapsed platform and offers a recoverable empty state", () => {
    render(<CompatibilityTab />);
    const search = screen.getByRole("searchbox", {
      name: "Find a platform or library",
    });
    fireEvent.change(search, { target: { value: "agent-framework-core" } });
    expect(
      screen.getByRole("button", { name: "Expand MAF Python libraries" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand MAF .NET libraries" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Expand AWS Strands Python libraries",
      }),
    ).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "no-such-platform" } });
    expect(screen.getByText("No matching platforms")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(
      screen.getByRole("button", { name: "Expand LangGraph libraries" }),
    ).toBeInTheDocument();
  });

  it("omits excluded packages from expanded columns and search", () => {
    render(<CompatibilityTab />);
    const before = screen.getAllByRole("columnheader").length;
    fireEvent.click(screen.getByRole("button", { name: "Expand libraries" }));
    expect(screen.getAllByRole("columnheader")).toHaveLength(before + 33);
    expect(screen.queryByText("Not included")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Built-in Agent libraries/ }),
    ).not.toBeInTheDocument();
    expectAlignedRows();

    const excluded = [
      "ag-ui-adk",
      "ag-ui-crewai",
      "@ag-ui/langgraph",
      "@ag-ui/aws-strands",
      "ag_ui_strands",
      "strands-agents-tools",
      "@copilotkit/runtime",
      "Microsoft.Agents.AI.OpenAI",
      "Microsoft.Extensions.AI.OpenAI",
      "com.ag-ui.community:spring-ai",
    ];
    for (const name of excluded) {
      expect(screen.queryByText(name, { exact: true })).not.toBeInTheDocument();
    }
    const search = screen.getByRole("searchbox", {
      name: "Find a platform or library",
    });
    for (const name of excluded) {
      fireEvent.change(search, { target: { value: name } });
      expect(screen.getByText("No matching platforms")).toBeInTheDocument();
    }
  });

  it("keeps a zero-library platform useful without an expansion control", () => {
    render(<CompatibilityTab />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Find a platform or library" }),
      { target: { value: "Built-in Agent" } },
    );

    expect(
      screen.getByRole("columnheader", { name: "CopilotKit's Built-in Agent" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Built-in Agent libraries/ }),
    ).not.toBeInTheDocument();
    for (const metric of [
      "Compatibility",
      "Running version",
      "Grace target",
      "Latest",
      "Registry",
    ]) {
      expect(
        getMetricCell(metric, "Overview 1 variant · individual scores"),
      ).toHaveTextContent(/^Not applicable$/);
    }
    const expand = screen.getByRole("button", { name: "Expand libraries" });
    expect(expand).toBeDisabled();
    const before = screen.getAllByRole("columnheader").length;
    fireEvent.click(expand);
    expect(screen.getAllByRole("columnheader")).toHaveLength(before);
    expect(
      screen.queryByRole("link", { name: "Registry" }),
    ).not.toBeInTheDocument();
    expectAlignedRows();
  });

  it("uses distinct expanded keys for standalone library inventory", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      render(<CompatibilityTab />);
      const before = screen.getAllByRole("columnheader").length;

      fireEvent.click(
        screen.getByRole("button", { name: "Expand .NET Harness libraries" }),
      );
      expect(screen.getAllByRole("columnheader")).toHaveLength(before + 2);
      expect(
        screen.getByRole("columnheader", {
          name: /Microsoft.Agents.AI.Harness/,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: "Expand AWS Strands Python libraries",
        }),
      ).toBeInTheDocument();
      expectAlignedRows();

      fireEvent.click(
        screen.getByRole("button", { name: "Collapse .NET Harness libraries" }),
      );
      expect(screen.getAllByRole("columnheader")).toHaveLength(before);
      expect(
        screen.getByRole("button", {
          name: "Expand AWS Strands Python libraries",
        }),
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
