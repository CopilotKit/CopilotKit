"use client";

import { useCallback } from "react";
import type { PageIndex } from "@/lib/live-pages";
import { whereIs } from "@/lib/live-pages";
import {
  ROOT_FRAMEWORK,
  frontendSegment,
  liveFramework,
} from "@/lib/live-scope";
import type { FrontendId } from "./data";
import { useFrontend } from "./frontend";
import { useLastFramework } from "./last-framework";
import { useLivePages } from "./live-pages-context";

/** The framework a stack's URLs name: none for the built-in agent's pages, or a framework without docs. */
function urlFramework(framework: string | null | undefined) {
  return framework && framework !== ROOT_FRAMEWORK && liveFramework(framework)
    ? framework
    : null;
}

/** A stack's URL prefix: `/vue/mastra`, `/mastra` on React, `""` for React and the built-in agent. */
export function stackPrefix(
  frontend: FrontendId,
  framework: string | null | undefined,
) {
  const fw = urlFramework(framework);
  const fe = frontend !== "react" ? `/${frontendSegment(frontend)}` : "";
  return `${fe}${fw ? `/${fw}` : ""}`;
}

/**
 * A live docs page's URL on a stack (`intelligence/overview` on Vue with
 * Mastra is `/vue/mastra/intelligence/overview`), or null when the stack has
 * no such page (`pages` says where every page lives). `""` is the stack's
 * home: React's is the framework's quickstart (frameworks have no landing
 * page), another frontend's its root page.
 */
export function stackPage(
  frontend: FrontendId,
  framework: string | null | undefined,
  slug: string,
  pages: PageIndex | null,
) {
  const at =
    pages && slug
      ? whereIs(pages, frontend, urlFramework(framework), slug)
      : undefined;
  if (at === null) return null;
  // Off React, `quickstart` is the frontend's root page (`/vue/mastra`, a
  // channel's overview): link its one indexed URL, not the alias.
  const root =
    frontend !== "react" &&
    slug === "quickstart" &&
    (at ? at.kind === "frontend" && at.slug === "" : true);
  const page = root ? "" : slug || (frontend === "react" ? "quickstart" : "");
  return `${stackPrefix(frontend, framework)}${page ? `/${page}` : ""}` || "/";
}

/**
 * `stackPage`, or the stack's home when it has no such page (React's is the
 * framework's quickstart, another frontend's its own home), so a link never
 * sends the reader off their stack or to a missing page.
 */
export function stackHref(
  frontend: FrontendId,
  framework: string | null | undefined,
  slug: string,
  pages: PageIndex | null,
): string {
  const home = `${stackPrefix(frontend, framework)}${frontend === "react" ? "/quickstart" : ""}`;
  return stackPage(frontend, framework, slug, pages) ?? (home || "/");
}

/**
 * `stackHref` on the reader's stack: the frontend and agent framework they
 * last read docs for. Either can be overridden, as a framework card does.
 */
export function useStackHref() {
  const { frontend } = useFrontend();
  const [framework] = useLastFramework();
  const pages = useLivePages();
  return useCallback(
    (slug: string, on?: { frontend?: FrontendId; framework?: string | null }) =>
      stackHref(
        on?.frontend ?? frontend,
        on && "framework" in on ? on.framework : framework,
        slug,
        pages,
      ),
    [frontend, framework, pages],
  );
}
