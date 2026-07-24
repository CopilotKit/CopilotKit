import { isChannelComponent } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";

// React tags elements with one of these symbols (pre-19 vs 19+).
const REACT_ELEMENT = Symbol.for("react.element");
const REACT_TRANSITIONAL = Symbol.for("react.transitional.element");

/** True for a React element (or React-element-shaped object). */
export function isReactElement(v: unknown): boolean {
  if (typeof v !== "object" || v === null || !("$$typeof" in v)) return false;
  const t = (v as { $$typeof: unknown }).$$typeof;
  return t === REACT_ELEMENT || t === REACT_TRANSITIONAL;
}

function isFnTypeNode(v: unknown): v is {
  type: (p: Record<string, unknown>) => unknown;
  props: Record<string, unknown>;
} {
  return (
    typeof v === "object" &&
    v !== null &&
    "type" in v &&
    "props" in v &&
    !("$$typeof" in v) &&
    typeof (v as ChannelNode).type === "function"
  );
}

/**
 * Resolve a `post()` argument to the React element that must be rendered as an
 * image, or `null` when it belongs on the native channel path.
 *
 * - A React element (host-tag app JSX, or app JSX authored in a react-pragma
 *   file) → image as-is, UNLESS its `type` is a branded channels-ui component
 *   (then native).
 * - A `{type: fn}` node whose fn is a first-party channels-ui component
 *   (branded) → native, no peek.
 * - Any other `{type: fn}` node → peek: call the fn once; if it returns a React
 *   element the component is app JSX (→ image) (unless that returned element's
 *   own `type` is a branded channels-ui component → native); if it returns
 *   channel nodes, or throws (e.g. it uses React hooks), it is a native
 *   component (→ null, native).
 *
 * Host tags (`<div>`) compile to React elements under the channels JSX runtime,
 * so they route via the React-element branch above — that's what distinguishes
 * them from the string-typed channel vocabulary (`{type: "section"}`), which
 * stays native.
 *
 * Peeking calls a presentational component once for classification; the native
 * path then calls it again during binding. This double call is acceptable for
 * the pure, presentational components this targets.
 */
export function resolveArbitraryElement(v: unknown): object | null {
  if (isReactElement(v)) {
    const t = (v as { type?: unknown }).type;
    // A branded channels-ui component (even authored as a React element) is native.
    if (typeof t === "function" && isChannelComponent(t)) return null;
    return v as object;
  }
  if (isFnTypeNode(v) && !isChannelComponent(v.type)) {
    try {
      const out = v.type(v.props ?? {});
      if (isReactElement(out)) {
        const ot = (out as { type?: unknown }).type;
        // Symmetric guard: an unbranded wrapper that peeks out to a branded
        // channels-ui element is still native — it must not route to the image path.
        if (typeof ot === "function" && isChannelComponent(ot)) return null;
        return out as object;
      }
    } catch (err) {
      // A throw here (e.g. the component uses React hooks) means it can't be
      // statically classified → route native. Logged at debug so a genuine
      // component bug is still discoverable rather than fully silent.
      console.debug(
        `[channel] resolveArbitraryElement: peek of <${(v as { type?: { name?: string } }).type?.name ?? "component"}> threw; routing native`,
        err,
      );
    }
  }
  return null;
}
