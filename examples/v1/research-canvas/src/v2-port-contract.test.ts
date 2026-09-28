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

test("routes every supported model through the bundled research agent", () => {
  const modelSelector = readSource("./components/ModelSelector.tsx");
  const modelSelectorProvider = readSource("./lib/model-selector-provider.tsx");
  const route = readSource("./app/api/copilotkit/[[...slug]]/route.ts");

  expect(modelSelector).not.toContain('value="crewai"');
  expect(modelSelector).toContain('value="google_genai"');
  expect(modelSelectorProvider).not.toContain("research_agent_crewai");
  expect(modelSelectorProvider).toContain('const agent = "research_agent";');
  expect(modelSelectorProvider).not.toContain("research_agent_google_genai");
  expect(route).not.toContain("research_agent_google_genai");
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

test("keeps research edits disabled until the agent is ready", () => {
  const researchCanvas = readSource("./components/ResearchCanvas.tsx");

  expect(researchCanvas).toContain("agent: researchAgent, isReady");
  expect(researchCanvas).toContain("disabled={!isReady}");
  expect(researchCanvas).toContain("aria-busy={!isReady}");
  expect(researchCanvas).toContain("if (!isReady) {");
  expect(researchCanvas).toContain(
    "handleCardClick={isReady ? handleCardClick : undefined}",
  );
  expect(researchCanvas).toContain(
    "removeResource={isReady ? removeResource : undefined}",
  );
});
