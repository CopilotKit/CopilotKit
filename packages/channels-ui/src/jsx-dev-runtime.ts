import { jsx } from "./jsx-runtime.js";
export { jsx, jsxs, Fragment } from "./jsx-runtime.js";
export type { JSX } from "./jsx-runtime.js";

export function jsxDEV(
  type: Parameters<typeof jsx>[0],
  props: Parameters<typeof jsx>[1],
  key?: string | number,
  _isStaticChildren?: boolean,
  _source?: unknown,
  _self?: unknown,
) {
  return jsx(type, props, key);
}
