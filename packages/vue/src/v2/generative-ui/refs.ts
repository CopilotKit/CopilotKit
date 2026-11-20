import type { VNode } from "vue";
import {
  child as sharedChild,
  childList as sharedChildList,
} from "@copilotkit/shared/generative-ui";

/**
 * One component id. The component receives the rendered child as a `VNode`.
 * Pass the description here, not with `.describe()`, which would replace the
 * mark. Mirrors React's `child`.
 *
 * @example
 * ```ts
 * const tabsSchema = z.object({
 *   tabs: z.array(z.object({ title: z.string(), child: child() })),
 * });
 * // The component gets `tabs: { title: string; child: VNode }[]`.
 * ```
 */
export function child(description?: string) {
  return sharedChild<VNode>(description);
}

/**
 * A list of component ids, or a template `{ componentId, path }` that
 * repeats one component for each item of the list at `path`. The component
 * receives the rendered children as one `VNode`. Pass the description here,
 * not with `.describe()`. Mirrors React's `childList`.
 */
export function childList(description?: string) {
  return sharedChildList<VNode>(description);
}
