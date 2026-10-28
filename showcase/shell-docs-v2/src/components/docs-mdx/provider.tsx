// MDX provider for the live content (`providerImportSource`): every compiled
// page and snippet file asks it for components, so a snippet a page imports
// renders with the page's components, as shell-docs' inlining gave it.
// Server-only: the content renders as React Server Components, and the
// page's scope comes from the per-request page store (`setDocsScope`).

import type { MDXComponents } from "mdx/types";
import { cache } from "react";
import { docsPageComponents } from "./index";
import { getDocsScope } from "./page-store";
import type { FrontendId } from "@/proto/data";

const pageComponents = cache((framework: string | null, frontend: FrontendId) =>
  docsPageComponents({ framework, frontend }),
);

export function useMDXComponents(components?: MDXComponents): MDXComponents {
  const { framework, frontend } = getDocsScope();
  const provided = pageComponents(framework, frontend);
  return components ? { ...provided, ...components } : provided;
}
