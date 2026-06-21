import { describe, expect, it } from "vitest";
import {
  analyzePrTour,
  formatMarkdown,
  scopeReportToRows,
} from "../pr-tour-report";

describe("pr-tour-report", () => {
  const features = [
    { id: "alpha", name: "Alpha" },
    { id: "beta", name: "Beta" },
  ];
  const integrations = [
    {
      slug: "one",
      name: "One",
      sortOrder: 1,
      demos: [
        {
          id: "alpha",
          route: "/demos/alpha",
          highlight: ["src/app/demos/alpha/page.tsx"],
        },
      ],
    },
    {
      slug: "two",
      name: "Two",
      sortOrder: 2,
      demos: [
        {
          id: "beta",
          route: "/demos/beta-demo",
          highlight: ["src/app/shared-beta.tsx"],
        },
      ],
    },
  ];

  it("maps demo source files to dashboard rows, columns, cells, and tour URL", () => {
    const report = analyzePrTour(
      [
        "showcase/integrations/one/src/app/demos/alpha/page.tsx",
        "showcase/integrations/two/src/app/demos/beta-demo/widget.tsx",
      ],
      features,
      integrations,
    );

    expect(report.rows.map((row) => row.id)).toEqual(["alpha", "beta"]);
    expect(report.columns.map((column) => column.slug)).toEqual(["one", "two"]);
    expect(
      report.cells.map((cell) => `${cell.column.slug}:${cell.row.id}`),
    ).toEqual(["one:alpha", "two:beta"]);
    expect(report.dashboardUrl).toBe(
      "http://localhost:3002/?rows=alpha,beta#matrix:links,depth,health,parity",
    );
  });

  it("maps docs files to local docs URLs", () => {
    const report = analyzePrTour(
      [
        "showcase/shell-docs/src/content/docs/generative-ui/tool-rendering/catch-all.mdx",
        "showcase/shell-docs/src/content/docs/integrations/ag2/quickstart.mdx",
      ],
      features,
      integrations,
    );

    expect(report.docsUrls).toEqual([
      "http://localhost:3003/ag2/quickstart",
      "http://localhost:3003/generative-ui/tool-rendering/catch-all",
    ]);
  });

  it("formats markdown for PR bodies", () => {
    const report = analyzePrTour(
      ["showcase/integrations/one/src/app/demos/alpha/page.tsx"],
      features,
      integrations,
    );

    expect(formatMarkdown(report)).toContain("## PR Tour");
    expect(formatMarkdown(report)).toContain("alpha — Alpha");
    expect(formatMarkdown(report)).toContain(
      "All listed rows across all listed columns (1 cells).",
    );
  });

  it("scopes an existing report to explicit dashboard rows", () => {
    const report = analyzePrTour(
      [
        "showcase/integrations/one/src/app/demos/alpha/page.tsx",
        "showcase/integrations/two/src/app/demos/beta-demo/widget.tsx",
      ],
      features,
      integrations,
    );

    const scoped = scopeReportToRows(report, ["beta"], features);

    expect(scoped.rows.map((row) => row.id)).toEqual(["beta"]);
    expect(scoped.columns.map((column) => column.slug)).toEqual(["two"]);
    expect(
      scoped.cells.map((cell) => `${cell.column.slug}:${cell.row.id}`),
    ).toEqual(["two:beta"]);
    expect(scoped.dashboardUrl).toBe(
      "http://localhost:3002/?rows=beta#matrix:links,depth,health,parity",
    );
  });
});
