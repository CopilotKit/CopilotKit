import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("loads the LangGraph deployment URL only from server configuration", () => {
  const route = readSource("./app/api/copilotkit/[[...slug]]/route.ts");
  const page = readSource("./app/page.tsx");
  const modelSelectorProvider = readSource("./lib/model-selector-provider.tsx");

  expect(route).toContain(
    "const deploymentUrl = process.env.LGC_DEPLOYMENT_URL;",
  );
  expect(route).not.toContain("x-lgc-deployment-url");
  expect(page).not.toContain("x-lgc-deployment-url");
  expect(modelSelectorProvider).not.toContain("lgcDeploymentUrl");
});

test("offers only agent implementations that exist in the example", () => {
  const modelSelector = readSource("./components/ModelSelector.tsx");
  const modelSelectorProvider = readSource("./lib/model-selector-provider.tsx");

  expect(modelSelector).not.toContain('value="crewai"');
  expect(modelSelectorProvider).not.toContain("research_agent_crewai");
});

test("uses the HSL primary token as a valid CSS color", () => {
  const globalStyles = readSource("./app/globals.css");

  expect(globalStyles).toContain("color: hsl(var(--primary));");
  expect(globalStyles).not.toContain("color: var(--primary);");
});

test("replaces the delete question with a neutral completed status", () => {
  const researchCanvas = readSource("./components/ResearchCanvas.tsx");

  expect(researchCanvas).toContain('if (status === "complete")');
  expect(researchCanvas).toContain('role="status"');
  expect(researchCanvas).toContain("Response recorded.");
});
