import React from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MDXRemote } from "next-mdx-remote/rsc";
import { expect, test } from "vitest";
import { DocsPageView } from "@/components/docs-page-view";
import frontendCatalog from "@/data/frontend-catalog.json";

function findMdx(node: ReactNode):
  | ReactElement<{
      components: Record<string, React.ComponentType<Record<string, unknown>>>;
    }>
  | undefined {
  if (!React.isValidElement(node)) return undefined;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === MDXRemote) return element as ReturnType<typeof findMdx>;
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findMdx(child);
    if (found) return found;
  }
  return undefined;
}

async function codeTabTitles(
  integration: string,
  frontend: "angular" | "react",
) {
  const page = await DocsPageView({
    slugPath: "multi-agent/subagents",
    slugHrefPrefix: `/${frontend}/${integration}`,
    frameworkOverride: integration,
    frontendOverride: frontend,
    navTree: [],
  });
  const InlineDemo = findMdx(page)?.props.components.InlineDemo;
  if (!InlineDemo) throw new Error("Sub-agent page has no InlineDemo");
  const html = renderToStaticMarkup(<InlineDemo demo="subagents" />);
  return [...html.matchAll(/title="([^"]+)"/g)].map((match) => match[1]);
}

test("Angular sub-agent pages show shared Angular frontend and each integration's backend", async () => {
  const angularFiles = [
    "showcase/angular/src/app/features/agent-state/agent-state-feature.component.ts",
    "showcase/angular/src/app/features/agent-state/agent-state-cards.ts",
    "showcase/angular/src/app/features/agent-state/agent-state-model.ts",
    "showcase/angular/src/app/features/agent-state/subagent-renderer-config.ts",
    "showcase/angular/src/app/app.routes.ts",
    "showcase/angular/src/app/feature-agent.ts",
  ];

  expect(await codeTabTitles("strands-typescript", "angular")).toEqual([
    ...angularFiles,
    "src/agent/agent.ts",
    "src/agent/tools.ts",
    "src/agent/state.ts",
    "src/app/api/copilotkit/route.ts",
  ]);
  expect(await codeTabTitles("strands", "angular")).toEqual([
    ...angularFiles,
    "src/agents/agent.py",
    "src/app/api/copilotkit/route.ts",
  ]);
  expect(await codeTabTitles("langgraph-python", "angular")).toEqual([
    ...angularFiles,
    "src/agents/subagents.py",
    "src/app/api/copilotkit/route.ts",
  ]);
  expect(await codeTabTitles("strands-typescript", "react")).toEqual([
    "src/agent/agent.ts",
    "src/agent/tools.ts",
    "src/agent/state.ts",
    "src/app/demos/subagents/page.tsx",
    "src/app/demos/subagents/delegation-log.tsx",
    "src/app/api/copilotkit/route.ts",
  ]);

  const angularIntegrations = frontendCatalog.cells
    .filter(
      (cell) =>
        cell.frontend === "angular" &&
        cell.feature === "subagents" &&
        cell.frontend_status === "supported",
    )
    .map((cell) => cell.integration);
  expect(angularIntegrations).toHaveLength(22);
  for (const integration of angularIntegrations) {
    const titles = await codeTabTitles(integration, "angular");
    expect(titles.slice(0, angularFiles.length)).toEqual(angularFiles);
    expect(titles.length).toBeGreaterThan(angularFiles.length);
    expect(
      titles.some((title) => title.startsWith("src/app/demos/subagents/")),
    ).toBe(false);
  }
});
