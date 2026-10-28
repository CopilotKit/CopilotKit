// <InlineDemo demo="agentic-chat" />: a showcase cell running live, with its
// source a tab away. A port of shell-docs' InlineDemo (mdx-registry.tsx).
//
// The integration is the page's URL framework, else the page's
// `snippet_framework` (`defaultFramework`), else the `integration` prop: the
// URL wins, as in shell-docs. Unknown or undeployed integrations render
// nothing; a pair the catalog marks `unsupported` renders the same notice
// <Snippet> uses instead of a frame on a route that would 404.

import { DemoFrame } from "@/components/demo-frame";
import { getCatalogCell, getRegistry } from "../data";
import type { DocsScope } from "../scope";
import { DemoSource } from "./demo-source";
import { UnsupportedBox } from "./snippet";

const warned = new Set<string>();
/** Once per reason in development, so authors learn an embed rendered nothing. */
function warnEmpty(reason: string) {
  if (process.env.NODE_ENV === "production" || warned.has(reason)) return;
  warned.add(reason);
  console.warn(`[docs-mdx] <InlineDemo> rendered nothing: ${reason}`);
}

export function InlineDemo({
  scope,
  integration,
  demo,
  defaultFramework,
  showAllFiles,
}: {
  scope: DocsScope;
  integration?: string;
  demo?: string;
  defaultFramework?: string;
  /** Show every file in the Code tab, not just the highlighted ones. */
  showAllFiles?: boolean;
}) {
  const slug = scope.framework ?? defaultFramework ?? integration;
  if (!slug || !demo) {
    warnEmpty(`missing props (integration=${slug}, demo=${demo})`);
    return null;
  }
  const int = getRegistry().integrations.find((i) => i.slug === slug);
  if (!int || !int.deployed) {
    warnEmpty(
      int
        ? `"${slug}" is not deployed`
        : `no integration "${slug}" in the registry`,
    );
    return null;
  }
  const catalog = getCatalogCell(slug, demo);
  if (catalog?.status === "unsupported") {
    return (
      <UnsupportedBox
        integrationName={catalog.integration_name ?? int.name}
        featureName={catalog.feature_name ?? demo}
      />
    );
  }

  const entry = int.demos.find((d) => d.id === demo);
  const route = entry?.route ?? `/demos/${demo}`;
  const sourceHref =
    int.repo && route.startsWith("/demos/")
      ? `${int.repo}/src/app${route}`
      : undefined;
  const name = entry?.name ?? demo;

  // One demo window: the live demo, and its code a switch away in the bar.
  return (
    <DemoFrame
      label={name}
      sourceHref={sourceHref}
      height={550}
      views={[
        {
          label: "Demo",
          src: `${int.backend_url}/demos/${demo}`,
          title: `${int.name}: ${name} live demo`,
        },
        {
          label: "Code",
          content: (
            <DemoSource
              integration={slug}
              demo={demo}
              onlyHighlighted={!showAllFiles}
              bare
            />
          ),
        },
      ]}
    />
  );
}
