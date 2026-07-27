import { describe, expect, it } from "vitest";

import { frameworkOverviews } from "@/data/frameworks";
import frontendCatalogData from "@/data/frontend-catalog.json";
import { buildAngularBackendOverview } from "../angular-backend-overview";
import { getIntegrations } from "../registry";

interface CatalogCell {
  frontend: string;
  integration: string;
  feature: string;
  runnable: boolean;
}

const catalogCells = (frontendCatalogData as { cells: CatalogCell[] }).cells;

function exactRunnableAngularHref(href: string, integration: string): boolean {
  return catalogCells.some(
    (cell) =>
      cell.frontend === "angular" &&
      cell.integration === integration &&
      cell.runnable &&
      href ===
        `https://showcase.copilotkit.ai/angular/${integration}/${cell.feature}`,
  );
}

describe("buildAngularBackendOverview", () => {
  it("uses exact runnable cells for every generated Angular backend overview", () => {
    const generatedBackends = getIntegrations().filter(
      (integration) =>
        integration.docs_mode === "generated" &&
        frameworkOverviews[integration.slug] !== undefined,
    );

    expect(generatedBackends.length).toBeGreaterThan(0);
    for (const backend of generatedBackends) {
      const overview = buildAngularBackendOverview(
        frameworkOverviews[backend.slug],
        backend.slug,
      );
      const demoHrefs = [
        ...overview.supportedFeatures.flatMap((feature) =>
          feature.demoLink ? [feature.demoLink] : [],
        ),
        ...overview.liveDemos.map((demo) => demo.iframeUrl),
      ];

      expect(demoHrefs.length, backend.slug).toBeGreaterThan(0);
      expect(
        demoHrefs.every((href) => exactRunnableAngularHref(href, backend.slug)),
        backend.slug,
      ).toBe(true);
    }
  });

  it("preserves the generated overview while deriving exact Angular demo cells", () => {
    const source = frameworkOverviews["langgraph-python"];
    const overview = buildAngularBackendOverview(source, "langgraph-python");

    expect(overview.header).toBe(source.header);
    expect(overview.architectureImage).toBe(source.architectureImage);
    expect(overview.cta).toBe(source.cta);
    expect(overview.guideLink).toBe("/langgraph-python/quickstart");

    const demoHrefs = [
      ...overview.supportedFeatures.flatMap((feature) =>
        feature.demoLink ? [feature.demoLink] : [],
      ),
      ...overview.liveDemos.map((demo) => demo.iframeUrl),
    ];
    expect(demoHrefs.length).toBeGreaterThan(0);
    expect(
      demoHrefs.every((href) =>
        exactRunnableAngularHref(href, "langgraph-python"),
      ),
    ).toBe(true);
    expect(demoHrefs).not.toContain(
      "https://examples-coagents-ai-travel-app.vercel.app/",
    );
    expect(JSON.stringify(overview.liveDemos)).not.toMatch(
      /\bReact\b|useComponent|useHumanInTheLoop/,
    );
  });

  it("never falls through to a different backend's runnable cell", () => {
    const overview = buildAngularBackendOverview(
      frameworkOverviews["langgraph-python"],
      "google-adk",
    );
    const demoHrefs = [
      ...overview.supportedFeatures.flatMap((feature) =>
        feature.demoLink ? [feature.demoLink] : [],
      ),
      ...overview.liveDemos.map((demo) => demo.iframeUrl),
    ];

    expect(demoHrefs.length).toBeGreaterThan(0);
    expect(
      demoHrefs.every((href) => exactRunnableAngularHref(href, "google-adk")),
    ).toBe(true);
    expect(demoHrefs.some((href) => href.includes("/langgraph-python/"))).toBe(
      false,
    );
  });

  it("removes static demo links when no exact runnable cells exist", () => {
    const overview = buildAngularBackendOverview(
      frameworkOverviews["langgraph-python"],
      "missing-backend",
    );

    expect(
      overview.supportedFeatures.every(
        (feature) => feature.demoLink === undefined,
      ),
    ).toBe(true);
    expect(overview.liveDemos).toEqual([]);
  });
});
