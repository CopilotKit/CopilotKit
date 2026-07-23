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

/**
 * True when `v` is arbitrary JSX that must render as an image: a React element,
 * or a `ChannelNode` whose `type` is an unbranded function (an app component
 * authored inside a channels-pragma file). Everything channels-ui produces
 * (string types, `Fragment`, branded component fns) stays on the native path.
 */
export function isArbitraryJsx(v: unknown): boolean {
  if (isReactElement(v)) return true;
  if (
    typeof v === "object" &&
    v !== null &&
    "type" in v &&
    "props" in v &&
    !("$$typeof" in v)
  ) {
    const t = (v as ChannelNode).type;
    return typeof t === "function" && !isChannelComponent(t);
  }
  return false;
}
