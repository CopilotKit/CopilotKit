import { Fragment, HOST_ELEMENT } from "./ir.js";
import type { ChannelNode } from "./ir.js";
export { Fragment };

/** Keep native JSX dependency-free; only the lazy image renderer needs React. */
export function jsx(
  type: string | ((props: never) => unknown) | symbol,
  props: Record<string, unknown> | null,
  key?: string | number,
): ChannelNode {
  return {
    type: type as ChannelNode["type"],
    props: props ?? {},
    key,
    ...(typeof type === "string" ? { [HOST_ELEMENT]: true } : {}),
  };
}
export const jsxs = jsx;

/** What can nest inside a host tag: other elements, text, numbers, conditionals. */
type HostChild =
  | ChannelNode
  | string
  | number
  | boolean
  | null
  | undefined
  | HostChild[];

/**
 * The JSX type contract for this runtime. Declaring it here (rather than
 * relying on a global `JSX` namespace) is what makes the compiler actually
 * check element props: unknown attributes and bad children are errors, and
 * every element's type is a {@link ChannelNode}.
 *
 * Resolved by TypeScript because `jsxImportSource` points at this package, so
 * `<Section foo={1} />` is checked against `SectionProps` with excess-property
 * checking.
 */
export namespace JSX {
  /** The result of evaluating a JSX expression. */
  export type Element = ChannelNode;
  /**
   * Decouples "what can be used as a JSX tag" from "what a JSX expression
   * evaluates to" (TS 5.1+). Without this, TypeScript additionally requires
   * every function component's return type to be assignable to {@link Element}
   * — which breaks arbitrary app/React components (e.g. a presentational card
   * that returns a real `ReactElement`) authored directly as JSX
   * under this pragma. Those are intentionally unbranded: `thread.post` expands
   * them once and routes host markup to the image path.
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
  /**
   * Host/intrinsic tags (`<div>`, `<span>`, `<svg>`, …) — app markup destined
   * for the image path. They accept arbitrary attributes; `style`/`className`/
   * `children` get useful types. `style` is a loose CSS map (not React's
   * `CSSProperties`) so channels-ui stays type-level react-free — pass a plain
   * style object.
   */
  export interface IntrinsicElements {
    [tag: string]: {
      style?: Record<string, string | number>;
      className?: string;
      id?: string;
      children?: HostChild | HostChild[];
      [attr: string]: unknown;
    };
  }
}
