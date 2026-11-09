import type { ReactNode } from "react";
import {
  child as sharedChild,
  childList as sharedChildList,
} from "@copilotkit/shared/generative-ui";

/**
 * One component id. The component receives the rendered child. Pass the
 * description here, not with `.describe()`, which would replace the mark.
 *
 * @example
 * ```ts
 * const tabsSchema = z.object({
 *   tabs: z.array(z.object({ title: z.string(), child: child() })),
 * });
 * // The component gets `tabs: { title: string; child: ReactNode }[]`.
 * ```
 */
export function child(description?: string) {
  return sharedChild<ReactNode>(description);
}

/**
 * A list of component ids, or a template `{ componentId, path }` that
 * repeats one component for each item of the list at `path`. The
 * component receives the rendered children. Pass the description here,
 * not with `.describe()`.
 */
export function childList(description?: string) {
  return sharedChildList<ReactNode>(description);
}
