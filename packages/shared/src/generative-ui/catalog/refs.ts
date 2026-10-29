import { z } from "zod";
import { A2UI_CHILD_LIST_MARK, A2UI_COMPONENT_ID_MARK } from "../base";

/**
 * Schema helpers that mark a prop as a component reference, the way A2UI
 * 1.0 marks it with the `ComponentId` and `ChildList` common types. The
 * engine finds every marked prop in the props schema, at any depth, renders
 * the referenced components, and hands the component the rendered nodes in
 * place of the ids. The model sees the prop as `componentId` or as a list
 * of ids or a template.
 *
 * @example
 * ```ts
 * const tabsSchema = z.object({
 *   tabs: z.array(z.object({ title: z.string(), child: child() })),
 * });
 * // A React component gets `tabs: { title: string; child: ReactNode }[]`.
 * ```
 *
 * `TNode` is the type of a rendered child in the framework that renders the
 * UI. Each framework package exports `child` and `childList` with it set.
 */

const mark = (prefix: string, description: string | undefined) =>
  description ? `${prefix} ${description}` : prefix;

/**
 * One component id. The component receives the rendered child. Pass the
 * description here, not with `.describe()`, which would replace the mark.
 */
export function child<TNode = unknown>(description?: string) {
  return z
    .string()
    .min(1)
    .describe(mark(A2UI_COMPONENT_ID_MARK, description))
    .transform((value) => value as TNode);
}

/**
 * A list of component ids, or a template `{ componentId, path }` that
 * repeats one component for each item of the list at `path`. The
 * component receives the rendered children. Pass the description here,
 * not with `.describe()`.
 */
export function childList<TNode = unknown>(description?: string) {
  return z
    .union([
      z.array(z.string().min(1)),
      z.object({ componentId: z.string().min(1), path: z.string().min(1) }),
    ])
    .describe(mark(A2UI_CHILD_LIST_MARK, description))
    .transform((value) => value as TNode);
}
