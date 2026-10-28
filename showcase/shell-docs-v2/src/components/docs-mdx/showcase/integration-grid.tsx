// <IntegrationGrid path="agent-config" />: at the end of an unscoped feature
// page, the same page on each agent framework. Hidden on framework-scoped
// pages, where the URL already names a backend (as in shell-docs'
// integration-grid.tsx, which linked to the showcase's integration list
// instead of to each framework's page).

import type { ComponentType, ReactNode } from "react";
import {
  Card as FumadocsCard,
  Cards as FumadocsCards,
} from "fumadocs-ui/components/card";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { LIVE_FRAMEWORKS } from "@/lib/live-scope";
import type { DocsMdxContext } from "../context";
import { ROOT_FRAMEWORK, getDocsMode, getIntegrations } from "../data";
import type { DocsScope } from "../scope";
import { frameworkPageHref } from "./paths";

type CardsComponent = ComponentType<{ children?: ReactNode }>;
type CardComponent = ComponentType<{
  href?: string;
  title: ReactNode;
  icon?: ReactNode;
}>;

export function IntegrationGrid({
  scope,
  ctx,
  path,
  exclude = [],
  description,
}: {
  scope: DocsScope;
  ctx: DocsMdxContext;
  /** The page's path under each framework, e.g. `generative-ui/a2ui`. */
  path?: string;
  /** Framework slugs to leave out. */
  exclude?: string[];
  description?: string;
}) {
  // Root pages are the built-in agent's docs but name no backend in the URL.
  if (scope.framework && scope.framework !== ROOT_FRAMEWORK) return null;

  // A framework's URL serves its own page, or this shared one scoped to it,
  // so every link to a routed framework resolves.
  const frameworks = getIntegrations()
    .filter(
      (i) =>
        i.deployed &&
        i.slug in LIVE_FRAMEWORKS &&
        i.slug !== ROOT_FRAMEWORK &&
        getDocsMode(i.slug) !== "hidden" &&
        !exclude.includes(i.slug),
    )
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));

  const components = ctx.components() as Record<string, unknown>;
  const Cards = (components.Cards ?? FumadocsCards) as CardsComponent;
  const Card = (components.Card ?? FumadocsCard) as CardComponent;
  // The page's own heading, so it takes the same anchor as authored ones.
  const H2 = (components.h2 ?? "h2") as ComponentType<{
    id: string;
    children: ReactNode;
  }>;

  return (
    <>
      <H2 id="choose-your-ai-backend">Choose your AI backend</H2>
      {description ? <p>{description}</p> : null}
      <Cards>
        {frameworks.map((i) => (
          <Card
            key={i.slug}
            href={frameworkPageHref(i.slug, path ?? "", scope)}
            title={i.name}
            icon={<FrameworkLogo slug={i.slug} size={16} />}
          />
        ))}
      </Cards>
    </>
  );
}
