"use client";

import { useCallback } from "react";
import type { PageIndex } from "@/lib/live-pages";
import { whereIs } from "@/lib/live-pages";
import {
  ROOT_FRAMEWORK,
  frontendSegment,
  liveFramework,
} from "@/lib/live-scope";
import { landingPage } from "@/lib/frontends";
import type { FrontendId } from "@/lib/frontends";
import { useFrontend } from "./frontend";
import { useLastFramework } from "./last-framework";
import { useLivePages } from "./live-pages-context";

/** The framework a stack's URLs name: none for the built-in agent's pages, or a framework without docs. */
function urlFramework(framework: string | null | undefined) {
  return framework && framework !== ROOT_FRAMEWORK && liveFramework(framework)
    ? framework
    : null;
}

/**
 * A stack's URL prefix: `/vue/mastra`, `/mastra` on React, `""` for React and
 * the built-in agent. An early-access frontend's is its landing page
 * (`/whatsapp`), on every framework.
 */
export function stackPrefix(
  frontend: FrontendId,
  framework: string | null | undefined,
) {
  const landing = landingPage(frontend);
  if (landing) return landing;
  const fw = urlFramework(framework);
  const fe = frontend !== "react" ? `/${frontendSegment(frontend)}` : "";
  return `${fe}${fw ? `/${fw}` : ""}`;
}

/**
 * A live docs page's URL on a stack (`intelligence/overview` on Vue with
 * Mastra is `/vue/mastra/intelligence/overview`), or null when the stack has
 * no such page (`pages` says where every page lives). `""` is the stack's
 * landing.
 */
export function stackPage(
  frontend: FrontendId,
  framework: string | null | undefined,
  slug: string,
  pages: PageIndex | null,
) {
  if (pages && slug && !whereIs(pages, frontend, urlFramework(framework), slug))
    return null;
  return `${stackPrefix(frontend, framework)}${slug ? `/${slug}` : ""}` || "/";
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
