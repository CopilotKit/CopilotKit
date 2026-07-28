export interface ResolveDocsPageContextOptions {
  /**
   * Real showcase/backend integration used by Snippet, InlineDemo,
   * WhenFrameworkHas, backend tabs, and framework setup components.
   */
  frameworkOverride?: string | null;
  /** Frontmatter fallback used when the route does not select an integration. */
  frontmatterDefaultFramework?: string;
  /**
   * Optional documentation-only namespace for rewriting authored links.
   * `undefined` preserves the historical frameworkOverride behavior; `null`
   * explicitly disables framework link scoping.
   */
  linkNamespaceFramework?: string | null;
}

export type DocsPageContext = {
  backendFramework?: string;
  linkNamespaceFramework?: string | null;
};

/**
 * Keep example resolution and documentation link scoping as independent axes.
 *
 * Existing callers omit `linkNamespaceFramework`, preserving their current
 * behavior. A projected frontend surface can opt into a frontend link
 * namespace while retaining a real backend integration for examples.
 */
export function resolveDocsPageContext({
  frameworkOverride,
  frontmatterDefaultFramework,
  linkNamespaceFramework,
}: ResolveDocsPageContextOptions): DocsPageContext {
  return {
    backendFramework: frameworkOverride ?? frontmatterDefaultFramework,
    linkNamespaceFramework:
      linkNamespaceFramework === undefined
        ? frameworkOverride
        : linkNamespaceFramework,
  };
}
