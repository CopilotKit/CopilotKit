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

/**
 * A live docs page's URL on a stack: `intelligence/overview` on Vue with
 * Mastra is `/vue/mastra/intelligence/overview`. `""` is the stack's home
 * (React's is the framework's quickstart). When the stack has no such page
 * (`pages` says where every page lives), it is the stack's home instead, so a
 * link never sends the reader off their stack or to a missing page.
 */
export function stackHref(
  frontend: FrontendId,
  framework: string | null | undefined,
  slug: string,
  pages: PageIndex | null,
) {
  // The built-in agent's pages are the unscoped ones; a framework without
  // docs falls back to them too.
  const fw =
    framework && framework !== ROOT_FRAMEWORK && liveFramework(framework)
      ? framework
      : null;
  const exists = !pages || !slug || !!whereIs(pages, frontend, fw, slug);
  const page = exists && slug ? slug : frontend === "react" ? "quickstart" : "";
  const fe = frontend !== "react" ? `/${frontendSegment(frontend)}` : "";
  return `${fe}${fw ? `/${fw}` : ""}${page ? `/${page}` : ""}` || "/";
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
