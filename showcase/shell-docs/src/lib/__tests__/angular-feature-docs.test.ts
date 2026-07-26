import { expect, test } from "vitest";

import { getAngularFeatureDocs } from "../angular-feature-docs";

test("publishes typed source for every supported feature", () => {
  const features = getAngularFeatureDocs();

  expect(features).toHaveLength(41);
  for (const feature of features) {
    expect(feature.state).toBe("supported");
    const route = `https://showcase.copilotkit.ai/angular/${feature.integration}/${feature.id}`;
    expect(feature.runHref).toBe(feature.runnable ? route : null);
    expect(feature.sourceHref).toBe(`${route}/code`);
    expect(feature.apiHref).toMatch(/^\/reference\/angular/);
  }
  expect(
    features.filter((feature) => !feature.runnable).map(({ id }) => id),
  ).toEqual(["threadid-frontend-tool-roundtrip"]);
});

test("uses standalone Angular names and descriptions", () => {
  const features = getAngularFeatureDocs();
  const componentRendering = features.find(
    (feature) => feature.id === "gen-ui-tool-based",
  );
  const renderedCopy = features
    .flatMap((feature) => [feature.name, feature.description])
    .join("\n");

  expect(componentRendering).toMatchObject({
    name: "Generative UI: component rendering",
    description:
      "Render typed tool results with registerFrontendTool and a standalone Angular component.",
  });
  expect(renderedCopy).not.toMatch(/\bReact\b|\buse[A-Z]|<Copilot[A-Z]/);
});

test("omits CLI, Hashbrown, and JSON Renderer from Angular feature docs", () => {
  expect(getAngularFeatureDocs().map((feature) => feature.id)).not.toEqual(
    expect.arrayContaining([
      "cli-start",
      "declarative-hashbrown",
      "declarative-json-render",
    ]),
  );
});
