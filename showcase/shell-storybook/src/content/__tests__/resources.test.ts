import { describe, expect, it } from "vitest";

import { curatedResources } from "../resources";
import type { ResourceRef } from "../types";
import {
  createRegistryResolver,
  resolveDemo,
  resolveFeature,
  resolveResource,
} from "../../lib/registry";

const showcaseDemoHref =
  "https://showcase.copilotkit.ai/integrations/langgraph-python/beautiful-chat";

type FixtureFeature = {
  id: string;
  name: string;
  category: string;
  description: string;
  shell_docs_path?: string | null;
  og_docs_url?: string | null;
};

type FixtureOptions = {
  integrationId?: string;
  demoId?: string;
  repo?: string | null;
  route?: string | null;
  categories?: readonly { id: string; name: string }[];
  features?: readonly FixtureFeature[];
};

function createFixture({
  integrationId = "fixture-integration",
  demoId = "fixture-demo",
  repo = "https://example.com/repository",
  route = "/demos/fixture",
  categories = [{ id: "fixture-category", name: "Fixture Category" }],
  features = [
    {
      id: "fixture-feature",
      name: "Fixture Feature",
      category: "fixture-category",
      description: "A feature used to exercise the registry resolver.",
      shell_docs_path: "/fixture-feature",
    },
  ],
}: FixtureOptions = {}) {
  return {
    integrations: [
      {
        slug: integrationId,
        name: "Fixture Integration",
        repo,
        demos: [
          {
            id: demoId,
            name: "Fixture Demo",
            description: "A runnable fixture demo.",
            route,
          },
        ],
      },
    ],
    feature_registry: { categories, features },
  };
}

describe("resolveDemo", () => {
  it("resolves a runnable demo from the generated registry", () => {
    expect(resolveDemo("langgraph-python", "beautiful-chat")).toEqual({
      integrationName: "LangGraph (Python)",
      demoName: "Beautiful Chat",
      route: "/demos/beautiful-chat",
      repo: "https://github.com/CopilotKit/CopilotKit/tree/main/showcase/integrations/langgraph-python",
      storyHref: showcaseDemoHref,
      previewHref: `${showcaseDemoHref}/preview`,
      codeHref: `${showcaseDemoHref}/code`,
    });
  });

  it("names a missing integration in its error", () => {
    const resolver = createRegistryResolver(createFixture());

    expect(() =>
      resolver.resolveDemo("missing-integration", "fixture-demo"),
    ).toThrow(/missing-integration/);
  });

  it("names both IDs when a demo is missing", () => {
    const resolver = createRegistryResolver(createFixture());

    expect(() =>
      resolver.resolveDemo("fixture-integration", "missing-demo"),
    ).toThrow(
      /fixture-integration.*missing-demo|missing-demo.*fixture-integration/,
    );
  });

  it("rejects demos without a runnable route", () => {
    const resolver = createRegistryResolver(createFixture({ route: null }));

    expect(() =>
      resolver.resolveDemo("fixture-integration", "fixture-demo"),
    ).toThrow(
      /fixture-integration.*fixture-demo.*not runnable|fixture-demo.*fixture-integration.*not runnable/i,
    );
  });
});

describe("resolveResource", () => {
  it("resolves the curated Showcase home resource exactly", () => {
    expect(resolveResource({ kind: "curated", id: "showcase-home" })).toEqual({
      kind: "curated",
      label: "Open Showcase",
      href: "https://showcase.copilotkit.ai",
    });
  });

  it("fails loudly for an unknown curated resource that bypasses the type", () => {
    const unknownResource = {
      kind: "curated",
      id: "unknown-resource",
    } as unknown as ResourceRef;

    expect(() => resolveResource(unknownResource)).toThrow(/unknown-resource/);
  });

  it("fails loudly for an unknown resource kind that bypasses the type", () => {
    const fixtureResolver = createRegistryResolver(createFixture());
    const unknownResource = {
      kind: "unknown-kind",
    } as unknown as ResourceRef;

    expect(() => fixtureResolver.resolveResource(unknownResource)).toThrow(
      /unknown-kind/,
    );
  });

  it("names the invalid view and demo IDs when a demo view bypasses the type", () => {
    const fixtureResolver = createRegistryResolver(createFixture());
    const unknownView = {
      kind: "demo",
      integration: "fixture-integration",
      demo: "fixture-demo",
      view: "unknown-view",
    } as unknown as ResourceRef;

    expect(() => fixtureResolver.resolveResource(unknownView)).toThrow(
      /unknown-view.*fixture-integration.*fixture-demo|fixture-integration.*fixture-demo.*unknown-view/,
    );
  });

  it.each([
    ["story", `Open Beautiful Chat story`, showcaseDemoHref],
    ["preview", `Open Beautiful Chat live demo`, `${showcaseDemoHref}/preview`],
    ["code", `View Beautiful Chat code`, `${showcaseDemoHref}/code`],
  ] as const)(
    "resolves the exact %s view label and href for a demo resource",
    (view, label, href) => {
      expect(
        resolveResource({
          kind: "demo",
          integration: "langgraph-python",
          demo: "beautiful-chat",
          view,
        }),
      ).toEqual({ kind: "demo", label, href });
    },
  );

  it("resolves feature docs from the generated registry", () => {
    expect(
      resolveResource({ kind: "feature", feature: "beautiful-chat" }),
    ).toEqual({
      kind: "feature",
      label: "Read Beautiful Chat docs",
      href: "https://docs.copilotkit.ai/agentic-chat-ui",
    });
  });
});

describe("resolveFeature", () => {
  it("prefers the shell docs path and includes the category display name", () => {
    expect(resolveFeature("beautiful-chat")).toEqual({
      name: "Beautiful Chat",
      categoryName: "Dev Ex",
      docsHref: "https://docs.copilotkit.ai/agentic-chat-ui",
    });
  });

  it("fails loudly for a missing feature", () => {
    const resolver = createRegistryResolver(createFixture());

    expect(() => resolver.resolveFeature("missing-feature")).toThrow(
      /missing-feature/,
    );
  });
});

describe("createRegistryResolver", () => {
  it("resolves an injected registry independently of generated data", () => {
    const resolver = createRegistryResolver(createFixture());

    expect(resolver.resolveDemo("fixture-integration", "fixture-demo")).toEqual(
      {
        integrationName: "Fixture Integration",
        demoName: "Fixture Demo",
        route: "/demos/fixture",
        repo: "https://example.com/repository",
        storyHref:
          "https://showcase.copilotkit.ai/integrations/fixture-integration/fixture-demo",
        previewHref:
          "https://showcase.copilotkit.ai/integrations/fixture-integration/fixture-demo/preview",
        codeHref:
          "https://showcase.copilotkit.ai/integrations/fixture-integration/fixture-demo/code",
      },
    );
  });

  it("encodes integration and demo IDs as individual path segments", () => {
    const integrationId = "integration#?/%";
    const demoId = "demo#?/%";
    const resolver = createRegistryResolver(
      createFixture({ integrationId, demoId }),
    );
    const storyHref = `https://showcase.copilotkit.ai/integrations/${encodeURIComponent(
      integrationId,
    )}/${encodeURIComponent(demoId)}`;

    expect(resolver.resolveDemo(integrationId, demoId)).toMatchObject({
      storyHref,
      previewHref: `${storyHref}/preview`,
      codeHref: `${storyHref}/code`,
    });
  });

  it("omits a null repository destination", () => {
    const resolver = createRegistryResolver(createFixture({ repo: null }));

    expect(
      resolver.resolveDemo("fixture-integration", "fixture-demo"),
    ).not.toHaveProperty("repo");
  });

  it("rejects a non-HTTPS repository destination", () => {
    const resolver = createRegistryResolver(
      createFixture({ repo: "http://example.com/repository" }),
    );

    expect(() =>
      resolver.resolveDemo("fixture-integration", "fixture-demo"),
    ).toThrow(/fixture-integration.*HTTPS|HTTPS.*fixture-integration/i);
  });

  it("falls back to an HTTPS original docs URL", () => {
    const resolver = createRegistryResolver(
      createFixture({
        features: [
          {
            id: "fallback-feature",
            name: "Fallback Feature",
            category: "fixture-category",
            description: "Uses the original docs destination.",
            og_docs_url: "https://example.com/original-docs",
          },
        ],
      }),
    );

    expect(resolver.resolveFeature("fallback-feature")).toEqual({
      name: "Fallback Feature",
      categoryName: "Fixture Category",
      docsHref: "https://example.com/original-docs",
    });
  });

  it("rejects a non-HTTPS original docs URL", () => {
    const resolver = createRegistryResolver(
      createFixture({
        features: [
          {
            id: "unsafe-docs-feature",
            name: "Unsafe Docs Feature",
            category: "fixture-category",
            description: "Has an unsafe original docs destination.",
            og_docs_url: "http://example.com/original-docs",
          },
        ],
      }),
    );

    expect(() => resolver.resolveFeature("unsafe-docs-feature")).toThrow(
      /unsafe-docs-feature.*HTTPS|HTTPS.*unsafe-docs-feature/i,
    );
  });

  it("rejects a shell docs path that escapes the docs origin", () => {
    const resolver = createRegistryResolver(
      createFixture({
        features: [
          {
            id: "escaped-docs-feature",
            name: "Escaped Docs Feature",
            category: "fixture-category",
            description: "Attempts to escape the shell docs origin.",
            shell_docs_path: "//example.com/escaped-docs",
          },
        ],
      }),
    );

    expect(() => resolver.resolveFeature("escaped-docs-feature")).toThrow(
      /escaped-docs-feature.*docs\.copilotkit\.ai|docs\.copilotkit\.ai.*escaped-docs-feature/i,
    );
  });

  it("fails loudly when a feature has no docs destination", () => {
    const resolver = createRegistryResolver(
      createFixture({
        features: [
          {
            id: "missing-docs-feature",
            name: "Missing Docs Feature",
            category: "fixture-category",
            description: "Has no documentation destination.",
          },
        ],
      }),
    );

    expect(() => resolver.resolveFeature("missing-docs-feature")).toThrow(
      /missing-docs-feature/,
    );
  });

  it("names the feature and category IDs when the category is missing", () => {
    const resolver = createRegistryResolver(
      createFixture({
        categories: [],
        features: [
          {
            id: "orphaned-feature",
            name: "Orphaned Feature",
            category: "missing-category",
            description: "References a missing category.",
            shell_docs_path: "/orphaned-feature",
          },
        ],
      }),
    );

    expect(() => resolver.resolveFeature("orphaned-feature")).toThrow(
      /orphaned-feature.*missing-category|missing-category.*orphaned-feature/,
    );
  });
});

describe("curatedResources", () => {
  it("uses descriptive destination labels and HTTPS URLs", () => {
    for (const [id, resource] of Object.entries(curatedResources)) {
      expect(resource.href).toMatch(/^https:\/\//);
      expect(resource.label).not.toMatch(
        /^(Learn more|Click here|Read more)$/i,
      );
      expect(resolveResource({ kind: "curated", id } as ResourceRef)).toEqual({
        kind: "curated",
        ...resource,
      });
    }
  });
});
