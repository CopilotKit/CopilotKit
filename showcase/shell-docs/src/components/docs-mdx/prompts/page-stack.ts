"use client";

import { usePathname } from "next/navigation";
import type { DocsScope } from "../scope";

/** First URL segments that name a frontend, as shell-docs' URLs spell them. */
const FRONTEND_SEGMENTS = new Set([
  "react-spa",
  "vue",
  "angular",
  "react-native",
  "slack",
  "teams",
]);

/**
 * The reader's stack on this page, for prompts and analytics: the page's
 * scope, except that a frontend the URL names wins, so `/react-spa` (React in
 * scope) and `/frontends/angular` name their frontend the way shell-docs did.
 */
export function usePageStack(scope: DocsScope): {
  pathname: string;
  /** Docs framework slug; null on an unscoped page. */
  framework: string | null;
  /** Docs frontend id (`react`, `react-spa`, `vue`, …). */
  frontend: string;
} {
  const pathname = usePathname() ?? "";
  const parts = pathname.split("/").filter(Boolean);
  const segment = parts[0] === "frontends" ? parts[1] : parts[0];
  return {
    pathname,
    framework: scope.framework,
    frontend:
      segment && FRONTEND_SEGMENTS.has(segment) ? segment : scope.frontend,
  };
}
