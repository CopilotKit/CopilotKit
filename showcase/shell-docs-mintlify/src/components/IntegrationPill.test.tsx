import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { IntegrationPill } from "./IntegrationPill";

describe("IntegrationPill", () => {
  it("renders the current integration label (built-in) for root path", () => {
    const html = renderToString(<IntegrationPill currentPath="/" />);
    expect(html).toContain("CopilotKit");
  });

  it("renders LangGraph label when path is /langgraph/quickstart", () => {
    const html = renderToString(
      <IntegrationPill currentPath="/langgraph/quickstart" />,
    );
    expect(html).toContain("LangGraph");
  });

  it("renders ADK label when path is /adk/shared-state", () => {
    const html = renderToString(
      <IntegrationPill currentPath="/adk/shared-state" />,
    );
    expect(html).toContain("ADK");
  });
});
