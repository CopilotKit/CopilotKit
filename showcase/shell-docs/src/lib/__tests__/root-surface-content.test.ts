import { describe, expect, it, vi } from "vitest";
import type { DocFrontmatter } from "../docs-render";
import { resolveRootSurfaceContent } from "../root-surface-content";
import { ROOT_FRAMEWORK } from "../registry";

function doc(defaultCell?: string) {
  const fm: DocFrontmatter = {
    title: "Fixture",
    defaultCell,
  };

  return {
    source: "# Fixture",
    filePath: "/fixture.mdx",
    fm,
  };
}

function dependencies(
  docsMode: "authored" | "generated",
  documents: Record<string, ReturnType<typeof doc>>,
) {
  return {
    getDocsFolder: vi.fn(() => "built-in-agent"),
    getDocsMode: vi.fn(() => docsMode),
    loadDoc: vi.fn((slugPath: string) => documents[slugPath] ?? null),
  };
}

describe("resolveRootSurfaceContent", () => {
  it("selects authored Built-in Agent content before the root fallback", () => {
    const deps = dependencies("authored", {
      "integrations/built-in-agent/server-tools": doc(),
      "server-tools": doc("server-tools"),
    });

    expect(resolveRootSurfaceContent("server-tools", deps)).toEqual({
      contentSlugPath: "integrations/built-in-agent/server-tools",
      frameworkOverride: ROOT_FRAMEWORK,
    });
    expect(deps.loadDoc).toHaveBeenCalledTimes(1);
    expect(deps.loadDoc).toHaveBeenCalledWith(
      "integrations/built-in-agent/server-tools",
    );
  });

  it("uses root content when the default framework is not authored", () => {
    const deps = dependencies("generated", {
      "integrations/built-in-agent/quickstart": doc(),
      quickstart: doc(),
    });

    expect(resolveRootSurfaceContent("quickstart", deps)).toEqual({
      frameworkOverride: undefined,
    });
    expect(deps.loadDoc).toHaveBeenCalledTimes(1);
    expect(deps.loadDoc).toHaveBeenCalledWith("quickstart");
  });

  it("applies the root framework only when root content declares a snippet cell", () => {
    const deps = dependencies("authored", {
      "concepts/architecture": doc("architecture"),
    });

    expect(resolveRootSurfaceContent("concepts/architecture", deps)).toEqual({
      frameworkOverride: ROOT_FRAMEWORK,
    });
  });

  it("keeps root content framework-agnostic without a snippet cell", () => {
    const deps = dependencies("authored", {
      "concepts/architecture": doc(),
    });

    expect(resolveRootSurfaceContent("concepts/architecture", deps)).toEqual({
      frameworkOverride: undefined,
    });
  });

  it("returns null when neither authored nor root content exists", () => {
    const deps = dependencies("authored", {});

    expect(resolveRootSurfaceContent("missing", deps)).toBeNull();
    expect(deps.loadDoc).toHaveBeenNthCalledWith(
      1,
      "integrations/built-in-agent/missing",
    );
    expect(deps.loadDoc).toHaveBeenNthCalledWith(2, "missing");
  });
});
