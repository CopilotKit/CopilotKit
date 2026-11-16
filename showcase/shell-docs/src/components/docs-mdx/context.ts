import type { MDXComponents } from "mdx/types";

/**
 * What a group of docs MDX components gets besides the page's scope.
 */
export interface DocsMdxContext {
  /**
   * The page's full MDX component map (Fumadocs' defaults, the app's own,
   * and every docs-mdx component, bound to the same scope). Components that
   * render MDX themselves (snippet partials, `<FrameworkSetup>`) pass it on
   * so nested content resolves the same names. Call it at render time, not
   * while building the map.
   */
  components(): MDXComponents;
}
