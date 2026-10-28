import type { MDXComponents } from "mdx/types";
import type { AnchorHTMLAttributes, ComponentType } from "react";
import Link from "next/link";
import { getMDXComponents } from "@/components/mdx";
import { scopedHref } from "@/lib/live-scope";
import { Accordion, Accordions } from "./accordion";
import { basicComponents } from "./basics";
import { createCards } from "./cards";
import type { DocsMdxContext } from "./context";
import { IframeSwitcher, IframeSwitcherGroup } from "./iframe-switcher";
import { CodePanel, CodeShowcase } from "./legacy/code-showcase";
import { CopilotKitCSS, InteractiveCSSInspector } from "./legacy/copilotkit-css";
import { ImageAndCode } from "./legacy/image-and-code";
import { If, MultiProviderContent } from "./legacy/multi-provider-content";
import { pageFrontmatter } from "./page-store";
import { promptComponents } from "./prompts";
import type { DocsScope } from "./scope";
import { showcaseComponents } from "./showcase";
import { snippetComponents } from "./snippets";
import { Tab, createTabs } from "./tabs";
import { TailoredContent, TailoredContentOption } from "./tailored-content";

export { setDocsScope, getDocsScope, type DocsPageInfo } from "./page-store";

/**
 * shell-docs gave `<Snippet>` (and its framework gates) the page's
 * `snippet_cell` / `snippet_framework` frontmatter as defaults, including
 * inside snippet files the page pulls in. Read at render time from the page
 * store (`setDocsScope`), so props authored on the tag still win.
 */
function withPageDefaults(
  Component: ComponentType<Record<string, unknown>>,
  defaults: Record<string, string>,
) {
  return function WithPageDefaults(props: Record<string, unknown>) {
    const injected: Record<string, string> = {};
    for (const [prop, key] of Object.entries(defaults)) {
      const value = pageFrontmatter(key);
      if (value !== undefined) injected[prop] = value;
    }
    return <Component {...injected} {...props} />;
  };
}

function build(scope: DocsScope) {
  let map: MDXComponents;
  let full: MDXComponents | undefined;
  const ctx: DocsMdxContext = {
    // For snippets a component renders itself: the page's map, with the
    // page's scoped links.
    components() {
      full ??= getMDXComponents({
        ...map,
        a: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
          const to = scopedHref(href, scope);
          return to?.startsWith("/") ? (
            <Link href={to} {...props} />
          ) : (
            <a href={to} {...props} />
          );
        },
      });
      return full;
    },
  };

  const showcase = showcaseComponents(scope, ctx) as Record<
    string,
    ComponentType<Record<string, unknown>>
  >;

  map = {
    ...basicComponents,
    ...createCards(scope),
    Tabs: createTabs(scope),
    Tab,
    Accordions,
    Accordion,
    TailoredContent,
    TailoredContentOption,
    IframeSwitcher,
    IframeSwitcherGroup,
    MultiProviderContent,
    If,
    CodeShowcase,
    CodePanel,
    CopilotKitCSS,
    InteractiveCSSInspector,
    ImageAndCode,
    FrontendOnly: ({ frontend, children }) =>
      frontend === scope.frontend ? <>{children}</> : null,
    ...showcase,
    Snippet: withPageDefaults(showcase.Snippet, {
      defaultFramework: "snippet_framework",
      defaultCell: "snippet_cell",
    }),
    InlineDemo: withPageDefaults(showcase.InlineDemo, {
      defaultFramework: "snippet_framework",
    }),
    WhenFrameworkHas: withPageDefaults(showcase.WhenFrameworkHas, {
      defaultFramework: "snippet_framework",
    }),
    ...promptComponents(scope, ctx),
    ...snippetComponents(ctx),
  };
  return { map, ctx };
}

/**
 * The MDX components the ported shell-docs content uses, bound to the page's
 * scope. Server components close over `scope`; client ones get it as a prop.
 * Content names them without importing (imports are stripped at sync, as
 * shell-docs stripped them), so every name it uses must be here.
 */
export function docsMdxComponents(scope: DocsScope): MDXComponents {
  return build(scope).map;
}

/**
 * The page's whole map: Fumadocs' and the app's MDX components, these, and
 * links scoped like prose links. What snippet files render with.
 */
export function docsPageComponents(scope: DocsScope): MDXComponents {
  return build(scope).ctx.components();
}
