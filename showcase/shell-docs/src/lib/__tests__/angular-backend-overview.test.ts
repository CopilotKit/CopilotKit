import { describe, expect, it } from "vitest";

import { frameworkOverviews } from "@/data/frameworks";
import frontendCatalogData from "@/data/frontend-catalog.json";
import registryData from "@/data/registry.json";
import {
  buildAngularBackendOverview,
  buildFrontendBackendOverview,
} from "../angular-backend-overview";
import { resolveAngularDoc } from "../angular-doc-navigation";
import { getFrontendCanonicalSlug } from "../frontend-page-content";
import { getIntegrations } from "../registry";

interface CatalogCell {
  frontend: string;
  integration: string;
  feature: string;
  runnable: boolean;
  demo_route: string;
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

function expectResolvableAngularDocumentationHref(
  href: string,
  integration: string,
): void {
  const prefix = `/${integration}/`;
  expect(href.startsWith(prefix), integration).toBe(true);
  const scopedSlug = href.slice(prefix.length).split(/[?#]/, 1)[0];
  const canonicalSlug = getFrontendCanonicalSlug("angular", scopedSlug);

  expect(canonicalSlug, href).toBe(scopedSlug);
  expect(resolveAngularDoc(integration, canonicalSlug), href).not.toBeNull();
}

describe("buildAngularBackendOverview", () => {
  it("resolves every generated documentation link through the Angular routing pipeline", () => {
    const generatedBackends = getIntegrations().filter(
      (integration) =>
        integration.docs_mode === "generated" &&
        frameworkOverviews[integration.slug] !== undefined,
    );

    for (const backend of generatedBackends) {
      const overview = buildAngularBackendOverview(
        frameworkOverviews[backend.slug],
        backend.slug,
      );

      for (const feature of overview.supportedFeatures) {
        expectResolvableAngularDocumentationHref(
          feature.documentationLink,
          backend.slug,
        );
      }
    }
  });

  it("canonicalizes Strands backend-tool docs to the Angular generative UI guide", () => {
    for (const integration of ["strands", "strands-typescript"]) {
      const overview = buildAngularBackendOverview(
        frameworkOverviews[integration],
        integration,
      );
      const generativeUi = overview.supportedFeatures.find(
        (feature) => feature.title === "Generative UI",
      );

      expect(generativeUi?.documentationLink).toBe(
        `/${integration}/guides/frontend-tools-generative-ui`,
      );
      expectResolvableAngularDocumentationHref(
        generativeUi!.documentationLink,
        integration,
      );
    }
  });

  it("falls back to the exact catalog capability when a source leaf has no Angular page", () => {
    const source = frameworkOverviews["langgraph-python"];
    const overview = buildAngularBackendOverview(
      {
        ...source,
        supportedFeatures: [
          {
            ...source.supportedFeatures[0],
            documentationLink: "/langgraph/not-an-angular-page",
          },
        ],
      },
      "langgraph-python",
    );

    expect(overview.supportedFeatures[0].documentationLink).toBe(
      "/langgraph-python/features#gen-ui-tool-based",
    );
    expectResolvableAngularDocumentationHref(
      overview.supportedFeatures[0].documentationLink,
      "langgraph-python",
    );
  });

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

  it("derives the Vue backend overview exclusively from runnable Vue catalog cells", () => {
    const overview = buildFrontendBackendOverview(
      "vue",
      frameworkOverviews.mastra,
      "mastra",
    );
    const runnableVueCells = catalogCells.filter(
      (cell) =>
        cell.frontend === "vue" &&
        cell.integration === "mastra" &&
        cell.runnable,
    );
    const mastra = registryData.integrations.find(
      (integration) => integration.slug === "mastra",
    )!;

    expect(overview.supportedFeatures).toHaveLength(runnableVueCells.length);
    expect(overview.supportedFeatures.map((feature) => feature.title)).toEqual(
      expect.arrayContaining(["Pre-Built: CopilotChat"]),
    );
    expect(
      overview.supportedFeatures.map((feature) => feature.title),
    ).not.toContain("Generative UI");
    expect(overview.supportedFeatures[0]?.demoLink).toBe(
      `${mastra.backend_url}/vue/agentic-chat`,
    );
    expect(overview.liveDemos[0]?.iframeUrl).toBe(
      `${mastra.backend_url}/vue/agentic-chat`,
    );
  });
});
