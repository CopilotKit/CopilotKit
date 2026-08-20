import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const quickstartSource = readFileSync(
  new URL("../../content/docs/frontends/angular.mdx", import.meta.url),
  "utf8",
);

describe("backend-scoped Angular quickstart", () => {
  it("keeps BuiltInAgent instructions out of the selected-backend branch", () => {
    const selectedBranch = quickstartSource.match(
      /<WhenAngularBackend selected>([\s\S]*?)<\/WhenAngularBackend>/,
    )?.[1];

    expect(selectedBranch).toBeDefined();
    expect(selectedBranch).toContain(
      '<FrameworkSetup concept="agent-setup" />',
    );
    expect(selectedBranch).toContain("Copilot Runtime guide");
    expect(selectedBranch).not.toContain("new BuiltInAgent");
  });

  it("preserves a production Intelligence continuation", () => {
    expect(quickstartSource).toContain("<OpsPlatformCTA");
    expect(quickstartSource).toContain(
      'surface="docs:angular/quickstart:production"',
    );
    expect(quickstartSource).toContain("Enterprise Intelligence");
  });

  it("imports the Angular Open Inspector step after the first chat", () => {
    expect(quickstartSource).toContain("open-inspector-step-angular.mdx");
    expect(quickstartSource).toContain("<OpenInspectorStepAngular");
    expect(
      quickstartSource.indexOf("<OpenInspectorStepAngular"),
    ).toBeGreaterThan(quickstartSource.indexOf("send a"));
  });
});
