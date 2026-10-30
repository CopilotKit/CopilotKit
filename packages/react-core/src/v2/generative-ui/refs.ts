import type { ReactNode } from "react";
import { z } from "zod";
import {
  A2UI_CHILD_LIST_MARK,
  A2UI_COMPONENT_ID_MARK,
} from "@copilotkit/shared";

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
 * // The component gets `tabs: { title: string; child: ReactNode }[]`.
 * ```
 */

const toNode = (value: unknown) => value as ReactNode;
const mark = (prefix: string, description: string | undefined) =>
  description ? `${prefix} ${description}` : prefix;

/**
 * One component id. The component receives the rendered child. Pass the
 * description here, not with `.describe()`, which would replace the mark.
 */
export function child(description?: string) {
  return z
    .string()
    .min(1)
    .describe(mark(A2UI_COMPONENT_ID_MARK, description))
    .transform(toNode);
}

/**
 * A list of component ids, or a template `{ componentId, path }` that
 * repeats one component for each item of the list at `path`. The
 * component receives the rendered children. Pass the description here,
 * not with `.describe()`.
 */
export function childList(description?: string) {
  return z
    .union([
      z.array(z.string().min(1)),
      z.object({ componentId: z.string().min(1), path: z.string().min(1) }),
    ])
    .describe(mark(A2UI_CHILD_LIST_MARK, description))
    .transform(toNode);
}
