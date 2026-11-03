// <InlineDemo demo="agentic-chat" />: a showcase cell running live, with its
// source a tab away. A port of shell-docs' InlineDemo (mdx-registry.tsx).
//
// The integration is the page's URL framework, else the page's
// `snippet_framework` (`defaultFramework`), else the `integration` prop: the
// URL wins, as in shell-docs. Unknown or undeployed integrations render
// nothing, and so does a demo the catalog marks `unsupported` (one the
// framework can't run yet): the page says so once (`MissingDemoBanner`).

import { DemoFrame } from "@/components/demo-frame";
import { getSiteHosts } from "@/lib/runtime-config";
import { demoOrigin } from "@/lib/site-hosts";
import type { DocsScope } from "../scope";
import { DemoSource } from "./demo-source";
import { inlineDemoTarget } from "./sources";

const warned = new Set<string>();
/** Once per reason in development, so authors learn an embed rendered nothing. */
function warnEmpty(reason: string) {
  if (process.env.NODE_ENV === "production" || warned.has(reason)) return;
  warned.add(reason);
  console.warn(`[docs-mdx] <InlineDemo> rendered nothing: ${reason}`);
}

export function InlineDemo({
  scope,
  showAllFiles,
  ...props
}: {
  scope: DocsScope;
  integration?: string;
  demo?: string;
  defaultFramework?: string;
  /** Show every file in the Code tab, not just the highlighted ones. */
  showAllFiles?: boolean;
}) {
  const target = inlineDemoTarget(props, scope);
  if ("empty" in target) {
    if (target.empty) warnEmpty(target.empty);
    return null;
  }
  const { slug, demo, int, entry } = target;
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
          src: `${demoOrigin(getSiteHosts(), slug)}/demos/${demo}`,
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
