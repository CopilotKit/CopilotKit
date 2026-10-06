import React from "react";
import type { ReactElement, ReactNode } from "react";
import { MDXRemote } from "next-mdx-remote/rsc";
import { describe, expect, it } from "vitest";
import { DocsPageView } from "@/components/docs-page-view";

function findMdxSource(node: ReactNode): string | undefined {
  if (!React.isValidElement(node)) {
    return undefined;
  }

  const element = node as ReactElement<{
    children?: ReactNode;
    source?: string;
  }>;
  if (element.type === MDXRemote) {
    return element.props.source;
  }

  const children = React.Children.toArray(element.props.children);
  for (const child of children) {
    const source = findMdxSource(child);
    if (source !== undefined) {
      return source;
    }
  }

  return undefined;
}

async function renderAngularQuickstart(frameworkOverride?: string) {
  const page = await DocsPageView({
    slugPath: frameworkOverride ? "quickstart" : "",
    contentSlugPath: "frontends/angular",
    slugHrefPrefix: frameworkOverride
      ? `/angular/${frameworkOverride}`
      : "/angular",
    frameworkOverride,
    frontendOverride: "angular",
    navTree: [],
  });
  const source = findMdxSource(page);

  expect(source).toBeDefined();
  return source!;
}

describe("DocsPageView Angular backend selection", () => {
  it("renders only standalone BuiltInAgent runtime instructions at /angular", async () => {
    const source = await renderAngularQuickstart();

    expect(source).toContain("### Create the Copilot Runtime");
    expect(source).toContain("new BuiltInAgent");
    expect(source).toContain("### Run the runtime and app");
    expect(source).not.toContain("Connect the selected agent backend");
    expect(source).not.toContain("<FrameworkSetup");
    expect(source).not.toContain("<WhenAngularBackend");
  });

  it("renders only selected-backend instructions at /angular/langgraph-python/quickstart", async () => {
    const source = await renderAngularQuickstart("langgraph-python");

    expect(source).toContain("### Connect the selected agent backend");
    expect(source).toContain('<FrameworkSetup concept="agent-setup" />');
    expect(source).toContain("### Run the backend, runtime, and Angular app");
    expect(source).not.toContain("### Create the Copilot Runtime");
    expect(source).not.toContain("new BuiltInAgent");
    expect(source).not.toContain("<WhenAngularBackend");
  });
});
