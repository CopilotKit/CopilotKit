import { cache } from "react";
import { UNSCOPED, type DocsScope } from "./scope";

/** What a ported page tells its MDX components besides its scope. */
export interface DocsPageInfo {
  /** The page's file under content/live (`docs/integrations/agno/ag-ui.mdx`). */
  path?: string;
  /** Its frontmatter; `snippet_cell` / `snippet_framework` default `<Snippet>`. */
  frontmatter?: Record<string, unknown>;
}

/**
 * The page being rendered, per request (React's `cache` is scoped to one
 * server render). The page sets it before rendering its MDX, so components
 * and snippet files deep in the tree read the same scope.
 */
const store = cache(() => ({
  scope: UNSCOPED as DocsScope,
  page: {} as DocsPageInfo,
}));

export function setDocsScope(scope: DocsScope, page: DocsPageInfo = {}) {
  const current = store();
  current.scope = scope;
  current.page = page;
}

export function getDocsScope(): DocsScope {
  return store().scope;
}

export function getDocsPage(): DocsPageInfo {
  return store().page;
}

/** A string frontmatter field of the page being rendered. */
export function pageFrontmatter(key: string): string | undefined {
  const value = store().page.frontmatter?.[key];
  return typeof value === "string" ? value : undefined;
}
