import { expect, test } from "vitest";

import featureRegistry from "../../shared/feature-registry.json";
import frontendRegistry from "../../shared/frontend-registry.json";
import { buildAngularFeatureSearchEntries } from "./angular-feature-search";

test("indexes every supported Angular feature", () => {
  const entries = buildAngularFeatureSearchEntries(
    frontendRegistry,
    featureRegistry,
  );

  expect(entries).toHaveLength(41);
  for (const entry of entries) {
    expect(entry.type).toBe("page");
    expect(entry.title).toMatch(/ — Angular example$/);
    expect(entry.section).toBe("Angular features");
    expect(entry.href).toMatch(/^\/angular\/features#[a-z0-9-]+$/);
  }
});

test("uses standalone Angular names and descriptions", () => {
  const entries = buildAngularFeatureSearchEntries(
    frontendRegistry,
    featureRegistry,
  );
  const componentRendering = entries.find(
    (entry) => entry.href === "/angular/features#gen-ui-tool-based",
  );
  const renderedCopy = entries
    .flatMap((entry) => [entry.title, entry.subtitle])
    .join("\n");

  expect(componentRendering).toMatchObject({
    title: "Generative UI: component rendering — Angular example",
    subtitle:
      "Render typed tool results with registerFrontendTool and a standalone Angular component.",
  });
  expect(renderedCopy).not.toMatch(/\bReact\b|\buse[A-Z]|<Copilot[A-Z]/);
});

test("omits CLI, Hashbrown, and JSON Renderer entries", () => {
  const hrefs = buildAngularFeatureSearchEntries(
    frontendRegistry,
    featureRegistry,
  ).map((entry) => entry.href);

  expect(hrefs).not.toEqual(
    expect.arrayContaining([
      "/angular/features#cli-start",
      "/angular/features#declarative-hashbrown",
      "/angular/features#declarative-json-render",
    ]),
  );
});
