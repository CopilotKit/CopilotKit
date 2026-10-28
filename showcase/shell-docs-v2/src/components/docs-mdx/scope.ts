import type { FrontendId } from "@/proto/data";

/**
 * Where a ported docs page is being read, from its URL: `/mastra/frontend-tools`
 * is scoped to Mastra, `/vue/mastra/frontend-tools` to Vue and Mastra. MDX
 * components that change with the reader's stack (snippets, demos, framework
 * gates) read it from here.
 */
export interface DocsScope {
  /** Agent framework slug (`mastra`, `langgraph-python`), or null when unscoped. */
  framework: string | null;
  /** The frontend; React when the URL names none. */
  frontend: FrontendId;
}

export const UNSCOPED: DocsScope = { framework: null, frontend: "react" };
