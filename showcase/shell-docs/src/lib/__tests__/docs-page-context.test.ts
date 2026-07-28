import { describe, expect, it } from "vitest";
import { resolveDocsPageContext } from "../docs-page-context";

describe("resolveDocsPageContext", () => {
  it("keeps the Vue link namespace separate from backend examples", () => {
    expect(
      resolveDocsPageContext({
        frameworkOverride: "built-in-agent",
        frontmatterDefaultFramework: "langgraph-python",
        linkNamespaceFramework: "vue",
      }),
    ).toEqual({
      backendFramework: "built-in-agent",
      linkNamespaceFramework: "vue",
    });
  });

  it("preserves existing framework behavior when no link namespace is set", () => {
    expect(
      resolveDocsPageContext({
        frameworkOverride: "mastra",
        frontmatterDefaultFramework: "built-in-agent",
      }),
    ).toEqual({
      backendFramework: "mastra",
      linkNamespaceFramework: "mastra",
    });
  });

  it("uses frontmatter only for backend selection", () => {
    expect(
      resolveDocsPageContext({
        frontmatterDefaultFramework: "built-in-agent",
      }),
    ).toEqual({
      backendFramework: "built-in-agent",
      linkNamespaceFramework: undefined,
    });
  });

  it("preserves an explicit null link namespace", () => {
    expect(
      resolveDocsPageContext({
        frameworkOverride: "built-in-agent",
        linkNamespaceFramework: null,
      }),
    ).toEqual({
      backendFramework: "built-in-agent",
      linkNamespaceFramework: null,
    });
  });
});
