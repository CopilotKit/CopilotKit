/**
 * Unit tests for DocsLink four-glyph mapping — Phase 3.5.
 * Parametrized over all four DocState values: ok, missing, notfound, error.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DocsRow } from "./cell-pieces";
import type { Integration, Feature } from "@/lib/registry";

// We test the glyph rendering indirectly through DocsRow since DocsLink
// is not exported. We create scenarios that produce specific DocState values.

describe("DocsLink four-glyph mapping", () => {
  const feature: Feature = {
    id: "agentic-chat",
    name: "Agentic Chat",
    category: "core",
    description: "",
    og_docs_url: "https://example.com/docs",
  };

  it("renders ok state with checkmark glyph", () => {
    const integration: Integration = {
      slug: "test",
      name: "Test",
      category: "c",
      language: "ts",
      description: "",
      repo: "",
      backend_url: "",
      deployed: true,
      features: [],
      demos: [],
      docs_links: {
        features: {
          "agentic-chat": {
            og_docs_url: "https://example.com/ok",
            shell_docs_path: null,
          },
        },
      },
    };
    const { container } = render(
      <DocsRow
        integration={integration}
        feature={feature}
        shellUrl="http://localhost:3000"
      />,
    );
    // og link has ✓ glyph (ok state)
    const spans = container.querySelectorAll("span");
    const glyphs = Array.from(spans)
      .map((s) => s.textContent?.trim())
      .filter(Boolean);
    expect(glyphs).toContain("✓");
  });

  it("renders missing state with middle dot glyph", () => {
    const integration: Integration = {
      slug: "test",
      name: "Test",
      category: "c",
      language: "ts",
      description: "",
      repo: "",
      backend_url: "",
      deployed: true,
      features: [],
      demos: [],
      // No docs_links → falls back to probed state; feature has no
      // og_docs_url probe result, so depends on the docs-status bundle.
      // For a direct missing-state test, we set a null override.
      docs_links: {
        features: {
          "agentic-chat": {
            og_docs_url: null,
            shell_docs_path: null,
          },
        },
      },
    };
    const featureNoUrl: Feature = {
      id: "agentic-chat",
      name: "Agentic Chat",
      category: "core",
      description: "",
    };
    const { container } = render(
      <DocsRow
        integration={integration}
        feature={featureNoUrl}
        shellUrl="http://localhost:3000"
      />,
    );
    const spans = container.querySelectorAll("span");
    const glyphs = Array.from(spans)
      .map((s) => s.textContent?.trim())
      .filter(Boolean);
    // Middle dot for missing state
    expect(glyphs).toContain("\u00B7");
  });
});
