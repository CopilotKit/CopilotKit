import { createRequire } from "node:module";
import { Fragment } from "./ir.js";
import type { ChannelNode } from "./ir.js";
export { Fragment };

/**
 * `react` is an OPTIONAL peer dependency, needed ONLY when you author host/
 * intrinsic tags (`<div>`, `<span>`, `<svg>`, …) in channel JSX. Those are app
 * markup for the image-render path, and are compiled to REAL React elements so
 * they're distinguishable (via `$$typeof`) from the string-typed channel
 * vocabulary (`{type: "section"}`, which stays native). Channel-component JSX
 * (`<Message>`, `<BarChart>`, …) is function-typed and never needs react — it
 * produces {@link ChannelNode}s. We resolve react's jsx-runtime lazily on first
 * host-tag use so channel-only, react-free deployments keep working.
 */
type JsxFn = (type: unknown, props: unknown, key?: unknown) => unknown;
let reactRuntime: { jsx: JsxFn; jsxs: JsxFn } | null | undefined;
function react(): { jsx: JsxFn; jsxs: JsxFn } {
  if (reactRuntime === undefined) {
    try {
      reactRuntime = createRequire(import.meta.url)("react/jsx-runtime");
    } catch {
      reactRuntime = null;
    }
  }
  if (!reactRuntime) {
    throw new Error(
      "Rendering host elements (e.g. <div>) in channel JSX requires `react` — " +
        "it is an optional peer dependency of @copilotkit/channels-ui used for the " +
        "image-render path. Install `react` (and `takumi-js`) to post JSX as images.",
    );
  }
  return reactRuntime;
}

function channelNode(
  type: ChannelNode["type"],
  props: Record<string, unknown> | null,
  key?: string | number,
): ChannelNode {
  return { type, props: props ?? {}, key };
}

/**
 * A host tag (string type) → a real React element (image path); a component or
 * Fragment → a {@link ChannelNode} (native path, or peeked/converted to the
 * image path). The React element is typed as `ChannelNode` to keep
 * {@link JSX.Element} uniform — `thread.post` and the runtime detection classify
 * by the *runtime* value, so the compile-time type is intentionally loose.
 */
export function jsx(
  type: string | ((props: never) => unknown) | symbol,
  props: Record<string, unknown> | null,
  key?: string | number,
): ChannelNode {
  if (typeof type === "string") {
    return react().jsx(type, props, key) as ChannelNode;
  }
  return channelNode(type as ChannelNode["type"], props, key);
}

export function jsxs(
  type: string | ((props: never) => unknown) | symbol,
  props: Record<string, unknown> | null,
  key?: string | number,
): ChannelNode {
  if (typeof type === "string") {
    return react().jsxs(type, props, key) as ChannelNode;
  }
  return channelNode(type as ChannelNode["type"], props, key);
}

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
   * — which breaks arbitrary app/React components (e.g. `@copilotkit/channels/charts`'
   * `BarChart`, which returns a real `ReactElement`) authored directly as JSX
   * under this pragma. Those are intentionally unbranded: `thread.post` peeks
   * at their output at runtime and routes them to the image path (see
   * `resolveArbitraryElement` in @copilotkit/channels-core render/detect).
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
