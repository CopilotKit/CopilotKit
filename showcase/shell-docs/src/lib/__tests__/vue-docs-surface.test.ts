import { describe, expect, it } from "vitest";
import type { NavNode } from "../docs-render";
import {
  projectVueDocsSurface,
  VueDocsSurfaceProjectionError,
} from "../vue-docs-surface";
import type {
  VueDocsRootContent,
  VueDocsVariantContent,
} from "../vue-docs-surface";

type FixtureOptions = {
  root?: Record<string, VueDocsRootContent>;
  variants?: VueDocsVariantContent[];
  missing?: string[];
};

function source({
  root = {},
  variants = [],
  missing = [],
}: FixtureOptions = {}) {
  const missingContent = new Set(missing);
  return {
    resolveRootContent: (route: string) => root[route] ?? null,
    vueVariants: variants,
    contentExists: (contentSlugPath: string) =>
      !missingContent.has(contentSlugPath),
  };
}

function diagnosticCodes(error: unknown) {
  expect(error).toBeInstanceOf(VueDocsSurfaceProjectionError);
  return (error as VueDocsSurfaceProjectionError).diagnostics.map(
    ({ code, route }) => `${code}:${route}`,
  );
}

describe("projectVueDocsSurface", () => {
  it("projects an isolated Vue surface while preserving hierarchy and ordering", () => {
    const rootNav: NavNode[] = [
      { type: "page", title: "Home", slug: "" },
      {
        type: "section",
        title: "Getting Started",
        icon: "lucide/Rocket",
      },
      { type: "page", title: "Quickstart", slug: "quickstart" },
      { type: "section", title: "Guides", icon: "lucide/BookOpen" },
      {
        type: "group",
        title: "Concepts",
        slug: "concepts",
        icon: "lucide/Boxes",
        defaultOpen: true,
        children: [
          {
            type: "page",
            title: "Concept index",
            slug: "concepts/index",
          },
          {
            type: "page",
            title: "Architecture",
            slug: "concepts/architecture",
          },
        ],
      },
    ];
    const original = structuredClone(rootNav);

    const projection = projectVueDocsSurface(
      rootNav,
      source({
        root: {
          quickstart: { contentSlugPath: "quickstart" },
          "concepts/index": {
            contentSlugPath: "concepts/index",
            vueDocs: "shared",
          },
          "concepts/architecture": {
            contentSlugPath: "concepts/architecture",
            vueDocs: "shared",
          },
        },
        variants: [
          {
            route: "quickstart",
            contentSlugPath: "frontends/vue",
          },
        ],
      }),
    );

    expect(rootNav).toEqual(original);
    expect(projection.pages).toEqual([
      {
        route: "quickstart",
        canonicalPath: "/vue",
        contentSlugPath: "frontends/vue",
        source: "vue-variant",
      },
      {
        route: "concepts/index",
        canonicalPath: "/vue/concepts/index",
        contentSlugPath: "concepts/index",
        source: "shared",
      },
      {
        route: "concepts/architecture",
        canonicalPath: "/vue/concepts/architecture",
        contentSlugPath: "concepts/architecture",
        source: "shared",
      },
    ]);
    expect(projection.navTree).toEqual([
      {
        type: "section",
        title: "Getting Started",
        icon: "lucide/Rocket",
      },
      {
        type: "page",
        title: "Quickstart",
        slug: "",
        href: "/vue",
      },
      { type: "section", title: "Guides", icon: "lucide/BookOpen" },
      {
        type: "group",
        title: "Concepts",
        slug: "concepts",
        icon: "lucide/Boxes",
        defaultOpen: true,
        children: [
          {
            type: "page",
            title: "Concept index",
            slug: "concepts/index",
            href: "/vue/concepts/index",
          },
          {
            type: "page",
            title: "Architecture",
            slug: "concepts/architecture",
            href: "/vue/concepts/architecture",
          },
        ],
      },
    ]);
  });

  it("removes excluded pages and prunes empty groups and sections", () => {
    const projection = projectVueDocsSurface(
      [
        { type: "section", title: "Keep" },
        { type: "page", title: "CLI", slug: "cli" },
        { type: "section", title: "Remove" },
        {
          type: "group",
          title: "Migrate",
          slug: "migrate",
          children: [
            { type: "page", title: "V2", slug: "migrate/v2" },
            { type: "page", title: "V1", slug: "migrate/v1" },
          ],
        },
      ],
      source({
        root: {
          cli: { contentSlugPath: "cli", vueDocs: "shared" },
          "migrate/v2": {
            contentSlugPath: "migrate/v2",
            vueDocs: "excluded",
          },
          "migrate/v1": {
            contentSlugPath: "migrate/v1",
            vueDocs: "not-applicable",
          },
        },
      }),
    );

    expect(projection.navTree).toEqual([
      { type: "section", title: "Keep" },
      { type: "page", title: "CLI", slug: "cli", href: "/vue/cli" },
    ]);
    expect(projection.pages.map((page) => page.route)).toEqual(["cli"]);
  });

  it("reports conflicting and unclassified routes with stable diagnostics", () => {
    expect.assertions(3);

    try {
      projectVueDocsSurface(
        [
          { type: "page", title: "Conflict", slug: "conflict" },
          { type: "page", title: "Unclassified", slug: "unclassified" },
        ],
        source({
          root: {
            conflict: {
              contentSlugPath: "conflict",
              vueDocs: "shared",
            },
            unclassified: { contentSlugPath: "unclassified" },
          },
          variants: [
            {
              route: "conflict",
              contentSlugPath: "frontends/vue/conflict",
            },
          ],
        }),
      );
    } catch (error) {
      expect(diagnosticCodes(error)).toEqual([
        "conflicting-content:conflict",
        "unclassified-route:unclassified",
      ]);
      expect((error as Error).message).toContain(
        "Vue docs surface projection failed with 2 diagnostic(s)",
      );
    }
  });

  it("detects invalid dispositions, orphan and duplicate content, and missing selections", () => {
    expect.assertions(2);

    try {
      projectVueDocsSurface(
        [
          { type: "page", title: "Invalid", slug: "invalid" },
          { type: "page", title: "Duplicate", slug: "duplicate" },
          { type: "page", title: "Missing", slug: "missing" },
        ],
        source({
          root: {
            invalid: {
              contentSlugPath: "invalid",
              vueDocs: "future-value",
            },
            duplicate: { contentSlugPath: "duplicate" },
            missing: {
              contentSlugPath: "missing",
              vueDocs: "shared",
            },
          },
          variants: [
            { route: "duplicate", contentSlugPath: "frontends/vue/duplicate" },
            {
              route: "/duplicate/",
              contentSlugPath: "frontends/vue/duplicate/index",
            },
            { route: "orphan", contentSlugPath: "frontends/vue/orphan" },
          ],
          missing: ["missing"],
        }),
      );
    } catch (error) {
      expect(diagnosticCodes(error)).toEqual([
        "invalid-disposition:invalid",
        "duplicate-content:duplicate",
        "missing-selected-content:missing",
        "orphan-content:orphan",
      ]);
    }
  });

  it("detects duplicate rendered routes and missing root content", () => {
    expect.assertions(2);

    try {
      projectVueDocsSurface(
        [
          { type: "page", title: "First", slug: "same" },
          { type: "page", title: "Second", slug: "/same/" },
          { type: "page", title: "Missing", slug: "missing" },
        ],
        source({
          root: {
            same: { contentSlugPath: "same", vueDocs: "shared" },
          },
        }),
      );
    } catch (error) {
      expect(diagnosticCodes(error)).toEqual([
        "duplicate-route:same",
        "missing-root-content:missing",
      ]);
    }
  });
});
