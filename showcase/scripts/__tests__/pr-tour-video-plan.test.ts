import { describe, expect, it } from "vitest";
import {
  buildDocsTourPlan,
  buildShowcaseTourPlan,
  defaultDocsTourUrls,
} from "../pr-tour-video-plan";
import type { PrTourReport } from "../pr-tour-report";

describe("pr-tour-video-plan", () => {
  const report: PrTourReport = {
    rows: [
      {
        id: "tool-rendering-suppress-catchall",
        name: "Generative UI: Tool Rendering (Suppress catch-all)",
      },
    ],
    columns: [
      {
        slug: "langgraph-fastapi",
        name: "LangGraph (FastAPI)",
        sortOrder: 1,
        demos: [],
      },
    ],
    cells: [
      {
        row: {
          id: "tool-rendering-suppress-catchall",
          name: "Generative UI: Tool Rendering (Suppress catch-all)",
        },
        column: {
          slug: "langgraph-fastapi",
          name: "LangGraph (FastAPI)",
          sortOrder: 1,
          demos: [],
        },
      },
    ],
    docsUrls: [],
    docsFiles: [],
    globalFiles: [],
    dashboardUrl: null,
  };

  it("builds one showcase video topic per requested dashboard row", () => {
    const [topic] = buildShowcaseTourPlan(report, {
      shellUrl: "http://shell.test",
      dashboardUrl: "http://dashboard.test",
      outputDir: "/tmp/videos",
    });

    expect(topic.title).toBe("Tool rendering: suppress catch-all");
    expect(topic.dashboardUrl).toBe(
      "http://dashboard.test/?rows=tool-rendering-suppress-catchall#matrix:links,depth,health,parity",
    );
    expect(topic.outputFile).toBe(
      "/tmp/videos/tool-rendering-suppress-catchall.webm",
    );
    expect(topic.cells).toHaveLength(1);
    expect(topic.cells[0].previewUrl).toBe(
      "http://shell.test/integrations/langgraph-fastapi/tool-rendering-suppress-catchall/preview",
    );
    expect(topic.cells[0].codeTarget?.file).toContain(
      "use-suppress-catch-all-tool-rendering.ts",
    );
    expect(topic.cells[0].codeTarget?.lines).toMatch(/^\d+-\d+$/);
    expect(topic.cells[0].prompts.at(-1)).toMatchObject({
      title: "Custom prompt",
      source: "custom",
    });
  });

  it("can point selected showcase columns at a direct local demo app", () => {
    const [topic] = buildShowcaseTourPlan(report, {
      shellUrl: "http://shell.test",
      dashboardUrl: "http://dashboard.test",
      outputDir: "/tmp/videos",
      directPreviewBaseUrls: {
        "langgraph-fastapi": "http://localhost:3102",
      },
    });

    expect(topic.cells[0].previewUrl).toBe(
      "http://localhost:3102/demos/tool-rendering-suppress-catchall",
    );
    expect(topic.cells[0].codeUrl).toContain("http://shell.test");
  });

  it("builds docs walkthrough pages with selection needles", () => {
    const urls = defaultDocsTourUrls("http://docs.test");
    const plan = buildDocsTourPlan({
      docsUrl: "http://docs.test",
      outputDir: "/tmp/videos",
      urls,
    });

    expect(plan.outputFile).toBe("/tmp/videos/docs-tool-rendering.webm");
    expect(plan.pages[0]).toEqual({
      url: "http://docs.test/generative-ui/tool-rendering",
      selectText: "Catch-all Tool Rendering",
    });
    expect(
      plan.pages.some(
        (page) => page.selectText === "Render nothing from the catch-all",
      ),
    ).toBe(true);
  });
});
