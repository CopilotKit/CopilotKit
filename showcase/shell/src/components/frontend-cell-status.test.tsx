import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FrontendCellStatus } from "./frontend-cell-status";

describe("FrontendCellStatus", () => {
  it("shows the exact unavailable cell without an iframe fallback", () => {
    const html = renderToStaticMarkup(
      FrontendCellStatus({
        resolution: {
          kind: "backend-unavailable",
          cellId: "angular/crewai-crews/mcp-apps",
          frontend: { id: "angular", name: "Angular", runnable: true },
          integrationName: "CrewAI",
          featureName: "MCP Apps",
          reason: "This backend does not provide a runnable fixture.",
          exception: null,
        },
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("angular/crewai-crews/mcp-apps");
    expect(html).not.toContain("<iframe");
  });
});
