import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WhenAngularBackend } from "../when-angular-backend";

describe("WhenAngularBackend", () => {
  it("renders the standalone path without a selected backend", () => {
    expect(
      renderToStaticMarkup(
        <WhenAngularBackend selected={false}>BuiltInAgent</WhenAngularBackend>,
      ),
    ).toContain("BuiltInAgent");
  });

  it("renders only the selected-backend path for a scoped quickstart", () => {
    const selected = renderToStaticMarkup(
      <WhenAngularBackend currentFramework="langgraph-python">
        LangGraph setup
      </WhenAngularBackend>,
    );
    const standalone = renderToStaticMarkup(
      <WhenAngularBackend selected={false} currentFramework="langgraph-python">
        BuiltInAgent setup
      </WhenAngularBackend>,
    );

    expect(selected).toContain("LangGraph setup");
    expect(standalone).toBe("");
  });
});
