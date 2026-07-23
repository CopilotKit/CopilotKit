import { Fragment } from "./ir.js";
import type { ChannelNode } from "./ir.js";
export { Fragment };

export function jsx(
  type: string | ((props: never) => unknown) | symbol,
  props: Record<string, unknown> | null,
  key?: string | number,
): ChannelNode {
  return { type: type as ChannelNode["type"], props: props ?? {}, key };
}
export const jsxs = jsx;

/**
 * The JSX type contract for this runtime. Declaring it here (rather than
 * relying on a global `JSX` namespace) is what makes the compiler actually
 * check element props: unknown attributes and bad children are errors, and
 * every element returns an {@link ChannelNode}.
 *
 * Resolved by TypeScript because `jsxImportSource` points at this package, so
 * `<Section foo={1} />` is checked against `SectionProps` with excess-property
 * checking — there are no lowercase intrinsic tags.
 */
export namespace JSX {
  /** The result of evaluating a JSX expression. */
  export type Element = ChannelNode;
  /**
   * Decouples "what can be used as a JSX tag" from "what a JSX expression
   * evaluates to" (TS 5.1+). Without this, TypeScript additionally requires
   * every function component's return type to be assignable to {@link Element}
   * — which breaks arbitrary app/React components (e.g. `@copilotkit/channels/charts`'
   * `BarChart`, which returns a real `ReactElement`) authored directly as JSX
   * under this pragma. Those are intentionally unbranded: `thread.post` peeks
   * at their output at runtime and routes them to the image path (see
   * `resolveArbitraryElement` in @copilotkit/channels-core render/detect) —
   * this only widens what the *type checker* accepts as a valid tag, matching
   * that runtime behavior.
   */
  export type ElementType = string | symbol | ((props: never) => unknown);
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
