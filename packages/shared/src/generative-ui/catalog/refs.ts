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
 * Without it, the output is `GenerativeUIChildNode`, which
 * `GenerativeUIComponentProps` replaces with the node type of the framework.
 */

declare const childNodeBrand: unique symbol;

/**
 * A rendered child in a framework-free schema. `GenerativeUIComponentProps`
 * replaces it with the node type that the framework passes.
 */
export interface GenerativeUIChildNode {
  readonly [childNodeBrand]: true;
}

type ChildSchema<TNode> = z.ZodEffects<z.ZodString, TNode, string>;
type ChildListSchema<TNode> = z.ZodEffects<
  z.ZodUnion<
    [
      z.ZodArray<z.ZodString>,
      z.ZodObject<{ componentId: z.ZodString; path: z.ZodString }>,
    ]
  >,
  TNode
>;

// Without a type argument, `child()` gives `GenerativeUIChildNode`. A
// generic default is not enough: inside `z.object({ ... })`, TypeScript
// would infer `TNode` from the shape and give `any`.

const mark = (prefix: string, description: string | undefined) =>
  description ? `${prefix} ${description}` : prefix;

/**
 * One component id. The component receives the rendered child. Pass the
 * description here, not with `.describe()`, which would replace the mark.
 */
export function child(description?: string): ChildSchema<GenerativeUIChildNode>;
export function child<TNode>(description?: string): ChildSchema<TNode>;
export function child(description?: string): ChildSchema<unknown> {
  return z
    .string()
    .min(1)
    .describe(mark(A2UI_COMPONENT_ID_MARK, description))
    .transform((value) => value as unknown);
}

/**
 * A list of component ids, or a template `{ componentId, path }` that
 * repeats one component for each item of the list at `path`. The
 * component receives the rendered children. Pass the description here,
 * not with `.describe()`.
 */
export function childList(
  description?: string,
): ChildListSchema<GenerativeUIChildNode>;
export function childList<TNode>(description?: string): ChildListSchema<TNode>;
export function childList(description?: string): ChildListSchema<unknown> {
  return z
    .union([
      z.array(z.string().min(1)),
      z.object({ componentId: z.string().min(1), path: z.string().min(1) }),
    ])
    .describe(mark(A2UI_CHILD_LIST_MARK, description))
    .transform((value) => value as unknown);
}
