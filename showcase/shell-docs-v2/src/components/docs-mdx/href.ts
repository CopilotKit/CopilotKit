import { scopedHref } from "@/lib/live-scope";
import type { DocsScope } from "./scope";

/**
 * Keep a docs link a component builds (a card, a grid tile) inside the
 * reader's docs surface: on `/mastra/...` a link to `/quickstart` goes to
 * `/mastra/quickstart`, as prose links do. Shell-docs' old
 * `/reference/v2/...` links read as `/reference/...`.
 */
export function docsHref(href: string, scope: DocsScope): string {
  const normalized = href.replace(/^\/reference\/v2\//, "/reference/");
  return scopedHref(normalized, scope) ?? normalized;
}
