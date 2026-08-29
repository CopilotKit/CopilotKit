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
    expect(quickstartSource).toContain("CopilotKit Intelligence");
  });

  it("imports the shared Open Inspector step after the first chat", () => {
    // Angular auto-mounts the Inspector from @copilotkit/angular >= 0.4.0, so it
    // uses the same step as every other web frontend rather than an Angular
    // variant that sends the reader off to install the element by hand.
    expect(quickstartSource).toContain("open-inspector-step.mdx");
    expect(quickstartSource).toContain("<OpenInspectorStep");
    expect(quickstartSource).not.toContain("open-inspector-step-angular");
    expect(quickstartSource.indexOf("<OpenInspectorStep")).toBeGreaterThan(
      quickstartSource.indexOf("send a"),
    );
  });
});
