import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FrontendCellStatus } from "./frontend-cell-status";

describe("FrontendCellStatus", () => {
  it("renders an actionable alert without a silent iframe fallback", () => {
    const html = renderToStaticMarkup(
      FrontendCellStatus({
        resolution: {
          kind: "unavailable",
          cellId: "angular/langgraph-python/agentic-chat",
          frontend: { id: "angular", name: "Angular", runnable: true },
          integrationName: "LangGraph Python",
          featureName: "Agentic Chat",
          reason: "Angular demos are not enabled in this environment.",
          exception: null,
        },
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Angular demos are not enabled");
    expect(html).toContain("angular/langgraph-python/agentic-chat");
    expect(html).not.toContain("<iframe");
  });

  it("labels malformed identities without inventing a cell", () => {
    const html = renderToStaticMarkup(
      FrontendCellStatus({
        resolution: {
          kind: "malformed",
          reason: 'Unknown Showcase integration "invalid".',
        },
      }),
    );

    expect(html).toContain("Invalid Showcase route");
    expect(html).toContain("Unknown Showcase integration");
  });
});
