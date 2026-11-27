import { ROOT_FRAMEWORK } from "../data";
import { docsHref } from "../href";
import type { DocsScope } from "../scope";

/**
 * A scope's home page: `/vue/mastra`, `/vue`, or `/`. A React framework has
 * no root page (`/mastra` redirects), so its home is `/mastra/quickstart`.
 */
function scopeRoot(scope: DocsScope): string {
  const frontend = scope.frontend !== "react" ? `/${scope.frontend}` : "";
  const framework =
    scope.framework && scope.framework !== ROOT_FRAMEWORK
      ? `/${scope.framework}`
      : "";
  if (!frontend && framework) return `${framework}/quickstart`;
  return `${frontend}${framework}` || "/";
}

/**
 * A page on another framework, kept on the reader's frontend:
 * `/vue/mastra/agent-config` from a Vue page. (`docsHref` leaves a link that
 * already names a framework as written.)
 */
export function frameworkPageHref(
  framework: string,
  path: string,
  scope: DocsScope,
): string {
  const target: DocsScope = { ...scope, framework };
  const page = path.replace(/^\/+/, "");
  return page ? docsHref(`/${page}`, target) : scopeRoot(target);
}
