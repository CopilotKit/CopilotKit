import { Fragment, type BotNode } from "./ir.js";
export { Fragment };

export function jsx(
  type: string | ((props: never) => unknown) | symbol,
  props: Record<string, unknown> | null,
  key?: string | number,
): BotNode {
  return { type: type as BotNode["type"], props: props ?? {}, key };
}
export const jsxs = jsx;

/**
 * The JSX type contract for this runtime. Declaring it here (rather than
 * relying on a global `JSX` namespace) is what makes the compiler actually
 * check element props: unknown attributes and bad children are errors, and
 * every element returns an {@link BotNode}.
 *
 * Resolved by TypeScript because `jsxImportSource` points at this package, so
 * `<Section foo={1} />` is checked against `SectionProps` with excess-property
 * checking — there are no lowercase intrinsic tags.
 */
export namespace JSX {
  /** The result of evaluating a JSX expression. */
  export type Element = BotNode;
  /** Tells TypeScript which prop receives nested children. */
  export interface ElementChildrenAttribute {
    children: {};
  }
  /** Props implicitly accepted by every element. */
  export interface IntrinsicAttributes {
    key?: string | number;
  }
  /** No lowercase intrinsic tags — the vocabulary is the capitalized components. */
  export interface IntrinsicElements {}
}
